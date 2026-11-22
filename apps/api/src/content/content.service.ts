import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { atcParent } from '../domain/codes';
import {
  AtcRow,
  ContentKind,
  diffRules,
  DoseLimitRow,
  DrugRow,
  parseAtcCsv,
  parseContraindicationsCsv,
  parseDoseLimitsCsv,
  parseDrugsCsv,
  parseFacilityFormularyCsv,
  parseHptCsv,
  parseInteractionsCsv,
  Parsed,
  primaryDdd,
  RowError,
  RuleKind,
  TEMPLATES,
} from '../domain/content';
import { toCsv } from '../domain/csv';
import { CreateDrugDto, UpdateDrugDto } from '../formulary/formulary.dto';
import { FormularyService } from '../formulary/formulary.service';
import { PrismaService } from '../prisma/prisma.service';
import { CodeSetCsvImportDto, DrugMasterImportDto, FacilityFormularyImportDto, ListRuleSetsQuery, RetireRuleSetDto, RuleSetImportDto } from './content.dto';

/** Above this share of loaded codes, a FULL release needs `force` (it is usually the wrong file). */
const RETIRE_GUARD = 0.25;
/** Long imports (the full WHO index) run in one transaction so a release is all-or-nothing. */
const TX = { timeout: 300_000, maxWait: 10_000 };
const LIST_LIMIT = 200;

export interface AffectedDrug {
  id: string;
  hptCode: string;
  atcCode: string;
  genericName: string;
  strength: string;
  reason: string;
}

const RULE_KIND_FILE: Record<RuleKind, ContentKind> = { INTERACTION: 'interactions', CONTRAINDICATION: 'contraindications', DOSE_LIMIT: 'dose-limits' };

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly formulary: FormularyService,
  ) {}

  template(kind: ContentKind): string {
    const t = TEMPLATES[kind];
    return toCsv(t.headers, [t.example]);
  }

  // ── Code sets ─────────────────────────────────────────────────────────────

  listImports() {
    return this.prisma.codeSetImport.findMany({ orderBy: { importedAt: 'desc' }, take: 100, omit: { errors: true } });
  }

  async getImport(id: string) {
    const rec = await this.prisma.codeSetImport.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException(`Import ${id} not found.`);
    return rec;
  }

  /** Drugs in the master that still point at a retired ATC or HPT code, or an HPT code PPB no longer lists as registered. */
  async drugsNeedingReview(): Promise<AffectedDrug[]> {
    const drugs = await this.prisma.drug.findMany({
      where: {
        formularyStatus: { not: 'DISCONTINUED' },
        OR: [{ atc: { retiredInRelease: { not: null } } }, { hpt: { retiredInRelease: { not: null } } }, { hpt: { ppbStatus: { in: WITHDRAWN } } }],
      },
      include: { atc: true, hpt: true },
      orderBy: { genericName: 'asc' },
    });
    return drugs.map((d) => ({
      ...pickDrug(d),
      reason: d.hpt.retiredInRelease
        ? `HPT code retired in ${d.hpt.retiredInRelease}`
        : d.hpt.ppbStatus && WITHDRAWN.includes(d.hpt.ppbStatus)
          ? `PPB status ${d.hpt.ppbStatus}`
          : `ATC code retired in ${d.atc.retiredInRelease}`,
    }));
  }

  async importAtc(dto: CodeSetCsvImportDto, actor: Actor) {
    const mode = dto.mode ?? 'PARTIAL';
    const parsed = parseAtcCsv(dto.csv);
    const errors = [...parsed.errors];
    const existing = new Map((await this.prisma.atcCode.findMany({ include: { ddds: true } })).map((c) => [c.code, c]));

    // Parents first; a child is only accepted once its parent is loaded or accepted.
    const known = new Set(existing.keys());
    const accepted: (AtcRow & { line: number })[] = [];
    for (const r of [...parsed.rows].sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))) {
      const parent = atcParent(r.code);
      if (parent && !known.has(parent)) {
        errors.push({ line: r.line, message: `Parent ${parent} of ${r.code} is not in the file or the loaded code set` });
        continue;
      }
      known.add(r.code);
      accepted.push(r);
    }
    errors.sort((a, b) => a.line - b.line);

    const created: typeof accepted = [];
    const changed: typeof accepted = [];
    const unchanged: string[] = [];
    for (const r of accepted) {
      const e = existing.get(r.code);
      if (!e) created.push(r);
      else if (e.name !== r.name || e.retiredInRelease || dddSignature(e.ddds) !== dddSignature(r.ddds)) changed.push(r);
      else unchanged.push(r.code);
    }
    const inFile = new Set(accepted.map((r) => r.code));
    const retired = mode === 'FULL' ? [...existing.values()].filter((e) => !e.retiredInRelease && !inFile.has(e.code)).map((e) => e.code) : [];
    const affectedDrugs = await this.drugsUsing('atcCode', retired, (c) => `ATC code ${c} is not in ${dto.release}`);

    const summary = this.summary('WHO_ATC', dto, mode, errors, parsed, created.length, changed.length, unchanged.length, retired, affectedDrugs);
    if (dto.dryRun) return summary;
    this.guardFull(mode, errors, retired.length, existing.size, dto.force);

    const rec = await this.prisma.$transaction(async (tx) => {
      for (const r of [...created, ...changed].sort((a, b) => a.code.length - b.code.length)) {
        const p = primaryDdd(r.ddds);
        const data = { level: levelOf(r.code), name: r.name, parentCode: atcParent(r.code), ddd: p?.ddd ?? null, dddUnit: p?.unit ?? null, dddRoute: p?.route ?? null, release: dto.release, retiredInRelease: null };
        await tx.atcCode.upsert({ where: { code: r.code }, create: { code: r.code, ...data }, update: data });
      }
      const touched = [...created, ...changed];
      await tx.atcDdd.deleteMany({ where: { code: { in: changed.map((r) => r.code) } } });
      await tx.atcDdd.createMany({
        data: touched.flatMap((r) => r.ddds.map((d) => ({ code: r.code, ddd: d.ddd, unit: d.unit, route: d.route, note: d.note, release: dto.release }))),
        skipDuplicates: true,
      });
      if (mode === 'FULL') await tx.atcCode.updateMany({ where: { code: { in: unchanged } }, data: { release: dto.release } });
      await tx.atcCode.updateMany({ where: { code: { in: retired } }, data: { retiredInRelease: dto.release } });
      return this.record(tx, summary, actor);
    }, TX);
    return { ...summary, importId: rec.id };
  }

  async importHpt(dto: CodeSetCsvImportDto, actor: Actor) {
    const mode = dto.mode ?? 'PARTIAL';
    const parsed = parseHptCsv(dto.csv);
    const existing = new Map((await this.prisma.hptCode.findMany()).map((c) => [c.code, c]));
    const created: typeof parsed.rows = [];
    const changed: typeof parsed.rows = [];
    const unchanged: string[] = [];
    for (const r of parsed.rows) {
      const e = existing.get(r.code);
      if (!e) created.push(r);
      else if (e.description !== r.description || (e.category ?? undefined) !== r.category || (e.ppbStatus ?? undefined) !== r.ppbStatus || e.retiredInRelease) changed.push(r);
      else unchanged.push(r.code);
    }
    const inFile = new Set(parsed.rows.map((r) => r.code));
    const retired = mode === 'FULL' ? [...existing.values()].filter((e) => !e.retiredInRelease && !inFile.has(e.code)).map((e) => e.code) : [];
    const withdrawn = parsed.rows.filter((r) => r.ppbStatus && WITHDRAWN.includes(r.ppbStatus)).map((r) => r.code);
    const affectedDrugs = [
      ...(await this.drugsUsing('hptCode', retired, (c) => `HPT code ${c} is not in ${dto.release}`)),
      ...(await this.drugsUsing('hptCode', withdrawn, (c) => `PPB status of ${c} is ${parsed.rows.find((r) => r.code === c)!.ppbStatus}`)),
    ];

    const summary = this.summary('PPB_HPT', dto, mode, parsed.errors, parsed, created.length, changed.length, unchanged.length, retired, affectedDrugs);
    if (dto.dryRun) return summary;
    this.guardFull(mode, parsed.errors, retired.length, existing.size, dto.force);

    const rec = await this.prisma.$transaction(async (tx) => {
      await tx.hptCode.createMany({ data: created.map((r) => ({ code: r.code, description: r.description, category: r.category, ppbStatus: r.ppbStatus, release: dto.release })) });
      for (const r of changed) {
        await tx.hptCode.update({ where: { code: r.code }, data: { description: r.description, category: r.category ?? null, ppbStatus: r.ppbStatus ?? null, release: dto.release, retiredInRelease: null } });
      }
      if (mode === 'FULL') await tx.hptCode.updateMany({ where: { code: { in: unchanged } }, data: { release: dto.release } });
      await tx.hptCode.updateMany({ where: { code: { in: retired } }, data: { retiredInRelease: dto.release } });
      return this.record(tx, summary, actor);
    }, TX);
    return { ...summary, importId: rec.id };
  }

  private summary(
    codeSystem: 'WHO_ATC' | 'PPB_HPT' | 'DRUG_MASTER' | 'FACILITY_FORMULARY',
    dto: { release?: string; dryRun?: boolean },
    mode: 'FULL' | 'PARTIAL',
    errors: RowError[],
    parsed: Parsed<unknown>,
    created: number,
    updated: number,
    unchanged: number,
    retired: string[],
    affectedDrugs: AffectedDrug[],
  ) {
    const failedLines = new Set(errors.filter((e) => e.line > 1).map((e) => e.line)).size;
    return {
      dryRun: !!dto.dryRun,
      codeSystem,
      release: dto.release ?? '',
      mode,
      rowsTotal: parsed.rows.length + failedLines,
      created,
      updated,
      unchanged,
      retired: retired.length,
      failed: errors.length,
      errors: errors.slice(0, 500),
      retiredCodes: retired.slice(0, LIST_LIMIT),
      affectedDrugs,
    };
  }

  private guardFull(mode: string, errors: RowError[], retired: number, loaded: number, force?: boolean) {
    if (mode !== 'FULL') return;
    if (errors.length)
      throw new UnprocessableEntityException({ message: 'A full release can only be loaded when every row is valid, otherwise codes with errors would be retired. Fix the rows listed, or load it as a partial update.', errors: errors.slice(0, 500) });
    if (loaded > 0 && retired / loaded > RETIRE_GUARD && !force)
      throw new UnprocessableEntityException({ message: `This release would retire ${retired} of ${loaded} loaded codes. Check it is the complete release; send force to load it anyway.` });
  }

  private async record(tx: Prisma.TransactionClient, s: ReturnType<ContentService['summary']>, actor: Actor) {
    const rec = await tx.codeSetImport.create({
      data: {
        codeSystem: s.codeSystem,
        release: s.release,
        mode: s.mode,
        rowsTotal: s.rowsTotal,
        rowsCreated: s.created,
        rowsUpdated: s.updated,
        rowsUnchanged: s.unchanged,
        rowsRetired: s.retired,
        rowsFailed: s.failed,
        importedBy: actor.id,
        errors: s.errors.length ? (s.errors as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
    await this.audit.log(tx, actor, 'content.import', 'CodeSetImport', rec.id, undefined, {
      codeSystem: s.codeSystem,
      release: s.release,
      mode: s.mode,
      created: s.created,
      updated: s.updated,
      retired: s.retired,
      failed: s.failed,
    });
    return rec;
  }

  private async drugsUsing(field: 'atcCode' | 'hptCode', codes: string[], reason: (code: string) => string): Promise<AffectedDrug[]> {
    if (!codes.length) return [];
    const drugs = await this.prisma.drug.findMany({ where: { [field]: { in: codes }, formularyStatus: { not: 'DISCONTINUED' } }, orderBy: { genericName: 'asc' } });
    return drugs.map((d) => ({ ...pickDrug(d), reason: reason(d[field]) }));
  }

  // ── Safety rule sets ──────────────────────────────────────────────────────

  async listRuleSets(q: ListRuleSetsQuery) {
    const [ruleSets, i, c, d] = await Promise.all([
      this.prisma.ruleSet.findMany({ where: { kind: q.kind, status: q.status }, orderBy: { importedAt: 'desc' }, omit: { errors: true } }),
      this.prisma.drugInteraction.count({ where: { ruleSetId: null, status: 'ACTIVE' } }),
      this.prisma.contraindication.count({ where: { ruleSetId: null, status: 'ACTIVE' } }),
      this.prisma.doseLimitRule.count({ where: { ruleSetId: null, status: 'ACTIVE' } }),
    ]);
    /** Rules entered before rule sets existed (seed data, manual). They stay active until retired in the database. */
    return { ruleSets, unmanaged: { INTERACTION: i, CONTRAINDICATION: c, DOSE_LIMIT: d } };
  }

  async importRuleSet(dto: RuleSetImportDto, actor: Actor) {
    const kind = dto.kind as RuleKind;
    const { rows, errors } = await this.parseRules(kind, dto.csv);
    const current = await this.activeSet(kind, dto.source);
    const comparedTo = current ? { ruleSetId: current.id, name: current.name, version: current.version, ...trimDiff(diffRules(kind, await this.rulesOf(kind, current.id), rows)) } : null;
    const summary = { dryRun: !!dto.dryRun, kind, rowsTotal: rows.length + new Set(errors.map((e) => e.line)).size, valid: rows.length, failed: errors.length, errors: errors.slice(0, 500), comparedTo };
    if (dto.dryRun) return { ...summary, preview: rows.slice(0, 20) };
    if (errors.length) throw new UnprocessableEntityException({ message: 'Every row must be valid before a rule set can be saved. Fix the rows listed and upload again.', ...summary });
    if (!rows.length) throw new UnprocessableEntityException({ message: 'The file has no rules.' });
    if (await this.prisma.ruleSet.findFirst({ where: { kind, source: dto.source, version: dto.version, status: { not: 'RETIRED' } } }))
      throw new ConflictException(`Version ${dto.version} from ${dto.source} is already loaded. Retire it first or use a new version.`);

    const set = await this.prisma.$transaction(async (tx) => {
      const set = await tx.ruleSet.create({
        data: { kind, name: dto.name, source: dto.source, version: dto.version, notes: dto.notes, rowsTotal: rows.length, rowsFailed: 0, importedBy: actor.id },
      });
      const base = { status: 'DRAFT' as const, ruleSetId: set.id };
      if (kind === 'INTERACTION')
        await tx.drugInteraction.createMany({ data: (rows as unknown as InteractionRule[]).map(({ line: _l, ...r }) => ({ ...r, source: dto.source, ...base })) });
      else if (kind === 'CONTRAINDICATION') await tx.contraindication.createMany({ data: (rows as unknown as ContraRule[]).map(({ line: _l, ...r }) => ({ ...r, ...base })) });
      else await tx.doseLimitRule.createMany({ data: (rows as unknown as DoseRule[]).map(({ line: _l, hptCode: _h, ...r }) => ({ ...r, ...base })) });
      await this.audit.log(tx, actor, 'ruleset.import', 'RuleSet', set.id, undefined, { kind, source: dto.source, version: dto.version, rules: rows.length });
      return set;
    }, TX);
    return { ...summary, ruleSet: set };
  }

  async getRuleSet(id: string) {
    const set = await this.prisma.ruleSet.findUnique({ where: { id } });
    if (!set) throw new NotFoundException(`Rule set ${id} not found.`);
    const kind = set.kind as RuleKind;
    const rules = await this.rulesOf(kind, id);
    const current = await this.activeSet(kind, set.source);
    const comparedTo =
      current && current.id !== id ? { ruleSetId: current.id, name: current.name, version: current.version, ...trimDiff(diffRules(kind, await this.rulesOf(kind, current.id), rules)) } : null;
    return { ...set, rules: rules.slice(0, 500), ruleCount: rules.length, comparedTo };
  }

  /** Second-pharmacist approval. Retires the previous active set from the same source in the same transaction. */
  async activateRuleSet(id: string, actor: Actor) {
    const set = await this.prisma.ruleSet.findUnique({ where: { id } });
    if (!set) throw new NotFoundException(`Rule set ${id} not found.`);
    if (set.status !== 'DRAFT') throw new ConflictException(`Only a draft can be activated; this set is ${set.status.toLowerCase()}.`);
    if (set.importedBy === actor.id) throw new ForbiddenException('A different pharmacist must approve a rule set from the one who loaded it.');
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ruleSet.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'ACTIVE', approvedBy: actor.id, approvedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('This rule set was changed by someone else. Reload and try again.');
      const previous = await tx.ruleSet.findMany({ where: { kind: set.kind, source: set.source, status: 'ACTIVE', id: { not: id } } });
      const prevIds = previous.map((p) => p.id);
      await tx.ruleSet.updateMany({ where: { id: { in: prevIds } }, data: { status: 'RETIRED', retiredBy: actor.id, retiredAt: new Date() } });
      await this.setRuleStatus(tx, set.kind as RuleKind, prevIds, 'RETIRED');
      await this.setRuleStatus(tx, set.kind as RuleKind, [id], 'ACTIVE');
      await this.audit.log(tx, actor, 'ruleset.activate', 'RuleSet', id, { status: 'DRAFT' }, { status: 'ACTIVE', retired: prevIds });
      return { ...(await tx.ruleSet.findUniqueOrThrow({ where: { id }, omit: { errors: true } })), retiredRuleSetIds: prevIds };
    });
  }

  async retireRuleSet(id: string, dto: RetireRuleSetDto, actor: Actor) {
    const set = await this.prisma.ruleSet.findUnique({ where: { id } });
    if (!set) throw new NotFoundException(`Rule set ${id} not found.`);
    if (set.status === 'RETIRED') throw new ConflictException('This rule set is already retired.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ruleSet.update({ where: { id }, data: { status: 'RETIRED', retiredBy: actor.id, retiredAt: new Date() }, omit: { errors: true } });
      await this.setRuleStatus(tx, set.kind as RuleKind, [id], 'RETIRED');
      await this.audit.log(tx, actor, 'ruleset.retire', 'RuleSet', id, { status: set.status }, { status: 'RETIRED', reason: dto.reason });
      return updated;
    });
  }

  async exportRuleSet(id: string): Promise<{ filename: string; csv: string }> {
    const set = await this.prisma.ruleSet.findUnique({ where: { id } });
    if (!set) throw new NotFoundException(`Rule set ${id} not found.`);
    const kind = set.kind as RuleKind;
    const rules = await this.rulesOf(kind, id);
    const t = TEMPLATES[RULE_KIND_FILE[kind]];
    const rows = rules.map((r) => {
      const x = r as Record<string, unknown>;
      if (kind === 'INTERACTION') return { atc_a: x.atcPrefixA, atc_b: x.atcPrefixB, severity: x.severity, description: x.description, management: x.management, ref: x.externalRef };
      if (kind === 'CONTRAINDICATION') return { atc: x.atcPrefix, diagnosis_system: x.diagnosisSystem, diagnosis_code: x.diagnosisPrefix, severity: x.severity, rationale: x.rationale, ref: x.externalRef };
      const yn = (b: unknown) => (b === null || b === undefined ? '' : b ? 'yes' : 'no');
      return {
        hpt_code: x.hptCode,
        atc: x.atcPrefix,
        route: x.route,
        min_age_months: x.minAgeMonths,
        max_age_months: x.maxAgeMonths,
        min_weight_kg: x.minWeightKg,
        max_weight_kg: x.maxWeightKg,
        crcl_below: x.crClBelow,
        hepatic_impairment: yn(x.hepaticImpairment),
        dose_unit: x.doseUnit,
        per_kg: yn(x.perKg),
        max_single_dose: x.maxSingleDose,
        max_daily_dose: x.maxDailyDose,
        severity: x.severity,
        note: x.note,
        ref: x.externalRef,
      };
    });
    const slug = `${set.source}-${set.version}`.replace(/[^A-Za-z0-9.-]+/g, '-');
    return { filename: `${RULE_KIND_FILE[kind]}-${slug}.csv`, csv: toCsv(t.headers, rows) };
  }

  private activeSet(kind: RuleKind, source: string) {
    return this.prisma.ruleSet.findFirst({ where: { kind, source, status: 'ACTIVE' }, orderBy: { approvedAt: 'desc' } });
  }

  /** Rules of a set as plain rows (dose limits carry the product's HPT code). */
  private async rulesOf(kind: RuleKind, ruleSetId: string): Promise<Record<string, unknown>[]> {
    if (kind === 'INTERACTION') return this.prisma.drugInteraction.findMany({ where: { ruleSetId }, orderBy: [{ atcPrefixA: 'asc' }, { atcPrefixB: 'asc' }] });
    if (kind === 'CONTRAINDICATION') return this.prisma.contraindication.findMany({ where: { ruleSetId }, orderBy: [{ atcPrefix: 'asc' }, { diagnosisPrefix: 'asc' }] });
    const rows = await this.prisma.doseLimitRule.findMany({ where: { ruleSetId }, include: { drug: { select: { hptCode: true } } }, orderBy: [{ atcPrefix: 'asc' }] });
    return rows.map(({ drug, ...r }) => ({ ...r, hptCode: drug?.hptCode ?? null }));
  }

  private async setRuleStatus(tx: Prisma.TransactionClient, kind: RuleKind, ruleSetIds: string[], status: 'ACTIVE' | 'RETIRED') {
    if (!ruleSetIds.length) return;
    const where = { ruleSetId: { in: ruleSetIds } };
    if (kind === 'INTERACTION') await tx.drugInteraction.updateMany({ where, data: { status } });
    else if (kind === 'CONTRAINDICATION') await tx.contraindication.updateMany({ where, data: { status } });
    else await tx.doseLimitRule.updateMany({ where, data: { status } });
  }

  /** File validation plus checks against loaded codes: every ATC code or class must exist and not be retired; dose-limit HPT codes must be drugs in the master. */
  private async parseRules(kind: RuleKind, csv: string): Promise<{ rows: AnyRule[]; errors: RowError[] }> {
    const parsed: Parsed<object> =
      kind === 'INTERACTION' ? parseInteractionsCsv(csv) : kind === 'CONTRAINDICATION' ? parseContraindicationsCsv(csv) : parseDoseLimitsCsv(csv);
    const errors = [...parsed.errors];
    const prefixes = new Set<string>();
    for (const r of parsed.rows as unknown as Record<string, unknown>[]) for (const k of ['atcPrefixA', 'atcPrefixB', 'atcPrefix']) if (r[k]) prefixes.add(r[k] as string);
    const atc = new Map((await this.prisma.atcCode.findMany({ where: { code: { in: [...prefixes] } }, select: { code: true, retiredInRelease: true } })).map((c) => [c.code, c]));
    const hpts = (parsed.rows as unknown as DoseLimitRow[]).map((r) => r.hptCode).filter((h): h is string => !!h);
    const drugs = new Map((await this.prisma.drug.findMany({ where: { hptCode: { in: hpts } }, select: { id: true, hptCode: true } })).map((d) => [d.hptCode, d.id]));
    const rows: AnyRule[] = [];
    for (const r of parsed.rows) {
      const x = r as unknown as AnyRule;
      const problems: string[] = [];
      for (const k of ['atcPrefixA', 'atcPrefixB', 'atcPrefix']) {
        const code = x[k] as string | undefined;
        if (!code) continue;
        const c = atc.get(code);
        if (!c) problems.push(`ATC ${code} is not in the loaded WHO ATC code set`);
        else if (c.retiredInRelease) problems.push(`ATC ${code} was retired in ${c.retiredInRelease}`);
      }
      let drugId: string | undefined;
      if (kind === 'DOSE_LIMIT' && x.hptCode) {
        drugId = drugs.get(x.hptCode as string);
        if (!drugId) problems.push(`No drug with HPT code ${x.hptCode as string} in the drug master`);
      }
      if (problems.length) problems.forEach((message) => errors.push({ line: x.line, message }));
      else rows.push(kind === 'DOSE_LIMIT' ? ({ ...x, drugId: drugId ?? null, atcPrefix: x.atcPrefix ?? null } as AnyRule) : (x as AnyRule));
    }
    errors.sort((a, b) => a.line - b.line);
    return { rows, errors };
  }

  // ── Facility formulary ────────────────────────────────────────────────────

  async exportFacilityFormulary(facilityId: string) {
    const entries = await this.prisma.facilityFormulary.findMany({ where: { facilityId }, include: { drug: { select: { hptCode: true, genericName: true } } }, orderBy: { drug: { genericName: 'asc' } } });
    return toCsv(
      [...TEMPLATES['facility-formulary'].headers, 'generic_name'],
      entries.map((e) => ({ hpt_code: e.drug.hptCode, status: e.status, approval_required_by: e.approvalRequiredBy, restriction_note: e.restrictionNote, generic_name: e.drug.genericName })),
    );
  }

  async importFacilityFormulary(facilityId: string, dto: FacilityFormularyImportDto, actor: Actor) {
    const mode = dto.mode ?? 'PARTIAL';
    const parsed = parseFacilityFormularyCsv(dto.csv);
    const errors = [...parsed.errors];
    const drugs = new Map((await this.prisma.drug.findMany({ where: { hptCode: { in: parsed.rows.map((r) => r.hptCode) } }, select: { id: true, hptCode: true } })).map((d) => [d.hptCode, d.id]));
    const existing = new Map((await this.prisma.facilityFormulary.findMany({ where: { facilityId } })).map((e) => [e.drugId, e]));
    const upserts: { drugId: string; status: (typeof parsed.rows)[number]['status']; approvalRequiredBy: string | null; restrictionNote: string | null }[] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const r of parsed.rows) {
      const drugId = drugs.get(r.hptCode);
      if (!drugId) {
        errors.push({ line: r.line, message: `No drug with HPT code ${r.hptCode} in the drug master` });
        continue;
      }
      const next = { drugId, status: r.status, approvalRequiredBy: r.approvalRequiredBy ?? null, restrictionNote: r.restrictionNote ?? null };
      const e = existing.get(drugId);
      if (!e) created++;
      else if (e.status !== next.status || e.approvalRequiredBy !== next.approvalRequiredBy || e.restrictionNote !== next.restrictionNote) updated++;
      else {
        unchanged++;
        continue;
      }
      upserts.push(next);
    }
    errors.sort((a, b) => a.line - b.line);
    const keep = new Set(parsed.rows.map((r) => drugs.get(r.hptCode)).filter(Boolean));
    const removed = mode === 'FULL' ? [...existing.values()].filter((e) => !keep.has(e.drugId)) : [];
    const removedDrugs = removed.length ? await this.prisma.drug.findMany({ where: { id: { in: removed.map((e) => e.drugId) } } }) : [];
    const summary = {
      ...this.summary('FACILITY_FORMULARY', { release: facilityId, dryRun: dto.dryRun }, mode, errors, parsed, created, updated, unchanged, removedDrugs.map((d) => d.hptCode), []),
      facilityId,
    };
    if (dto.dryRun) return summary;
    if (mode === 'FULL' && errors.length)
      throw new UnprocessableEntityException({ message: 'A full formulary can only be loaded when every row is valid, otherwise items with errors would be removed.', errors: errors.slice(0, 500) });

    const rec = await this.prisma.$transaction(async (tx) => {
      for (const u of upserts) {
        const { drugId, ...data } = u;
        await tx.facilityFormulary.upsert({ where: { facilityId_drugId: { facilityId, drugId } }, create: { facilityId, drugId, ...data }, update: data });
      }
      await tx.facilityFormulary.deleteMany({ where: { facilityId, drugId: { in: removed.map((e) => e.drugId) } } });
      return this.record(tx, summary, actor);
    }, TX);
    return { ...summary, importId: rec.id };
  }

  // ── Drug master ───────────────────────────────────────────────────────────

  async importDrugs(dto: DrugMasterImportDto, actor: Actor) {
    const parsed = parseDrugsCsv(dto.csv);
    const errors = [...parsed.errors];
    const hpt = new Map((await this.prisma.hptCode.findMany({ where: { code: { in: parsed.rows.map((r) => r.hptCode) } } })).map((c) => [c.code, c]));
    const atc = new Map((await this.prisma.atcCode.findMany({ where: { code: { in: parsed.rows.map((r) => r.atcCode) } } })).map((c) => [c.code, c]));
    const existing = new Map((await this.prisma.drug.findMany({ where: { hptCode: { in: parsed.rows.map((r) => r.hptCode) } } })).map((d) => [d.hptCode, d]));
    type Plan = { line: number; hptCode: string; action: 'create' | 'update'; fields: (typeof DRUG_FIELDS)[number][]; row: DrugRow; drugId?: string };
    const plans: Plan[] = [];
    let unchanged = 0;
    for (const r of parsed.rows) {
      const h = hpt.get(r.hptCode);
      const a = atc.get(r.atcCode);
      const problems: string[] = [];
      if (!h) problems.push(`HPT code ${r.hptCode} is not in the loaded PPB HPT code set`);
      else if (h.retiredInRelease) problems.push(`HPT code ${r.hptCode} was retired in ${h.retiredInRelease}`);
      if (!a) problems.push(`ATC code ${r.atcCode} is not in the loaded WHO ATC code set`);
      else if (a.retiredInRelease) problems.push(`ATC code ${r.atcCode} was retired in ${a.retiredInRelease}`);
      if (problems.length) {
        problems.forEach((message) => errors.push({ line: r.line, message }));
        continue;
      }
      const d = existing.get(r.hptCode);
      if (!d) {
        plans.push({ line: r.line, hptCode: r.hptCode, action: 'create', fields: [], row: r });
        continue;
      }
      const fields = DRUG_FIELDS.filter((f) => r[f] !== undefined && !sameValue(d[f], r[f]));
      if (fields.length) plans.push({ line: r.line, hptCode: r.hptCode, action: 'update', fields, row: r, drugId: d.id });
      else unchanged++;
    }
    errors.sort((a, b) => a.line - b.line);
    const created = plans.filter((p) => p.action === 'create').length;
    const summary = {
      ...this.summary('DRUG_MASTER', { release: 'DRUG-MASTER', dryRun: dto.dryRun }, 'PARTIAL', errors, parsed, created, plans.length - created, unchanged, [], []),
      changes: plans.slice(0, LIST_LIMIT).map(({ line, hptCode, action, fields }) => ({ line, hptCode, action, fields })),
    };
    if (dto.dryRun) return summary;

    // Each drug goes through the normal create/update path: versions, audit and CliniTrack catalogue events.
    for (const p of plans) {
      try {
        if (p.action === 'create') {
          const { line: _l, ...row } = p.row as DrugRow & { line: number };
          await this.formulary.createDrug({ ...row, brandNames: row.brandNames ?? [] } as CreateDrugDto, actor);
        } else {
          const changes = Object.fromEntries(p.fields.map((f) => [f, p.row[f as keyof DrugRow]]));
          await this.formulary.updateDrug(p.drugId!, { ...changes, reason: dto.reason } as UpdateDrugDto, actor);
        }
      } catch (e) {
        summary.errors.push({ line: p.line, message: e instanceof Error ? e.message : String(e) });
        summary.failed++;
        if (p.action === 'create') summary.created--;
        else summary.updated--;
      }
    }
    const rec = await this.prisma.$transaction((tx) => this.record(tx, summary, actor));
    return { ...summary, importId: rec.id };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const WITHDRAWN = ['WITHDRAWN', 'CANCELLED', 'SUSPENDED', 'DEREGISTERED'];

const DRUG_FIELDS = [
  'atcCode',
  'genericName',
  'brandNames',
  'strength',
  'strengthValue',
  'strengthUnit',
  'dosageForm',
  'route',
  'packSize',
  'unitOfIssue',
  'controlledSchedule',
  'formularyStatus',
  'pregnancyRisk',
  'lactationRisk',
] as const;

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  if (a instanceof Prisma.Decimal) return Number(a) === Number(b);
  return (a ?? null) === (b ?? null);
}

function pickDrug(d: { id: string; hptCode: string; atcCode: string; genericName: string; strength: string }) {
  return { id: d.id, hptCode: d.hptCode, atcCode: d.atcCode, genericName: d.genericName, strength: d.strength };
}

function levelOf(code: string): number {
  return { 1: 1, 3: 2, 4: 3, 5: 4, 7: 5 }[code.length]!;
}

function dddSignature(ddds: { ddd: unknown; unit: string; route: string; note?: string | null }[]): string {
  return ddds
    .map((d) => `${Number(d.ddd)}|${d.unit}|${d.route}|${d.note ?? ''}`)
    .sort()
    .join(';');
}

function trimDiff(d: ReturnType<typeof diffRules>) {
  return {
    added: d.added.length,
    removed: d.removed.length,
    changed: d.changed.length,
    unchanged: d.unchanged,
    addedKeys: d.added.slice(0, LIST_LIMIT),
    removedKeys: d.removed.slice(0, LIST_LIMIT),
    changedRules: d.changed.slice(0, LIST_LIMIT),
  };
}

type InteractionRule = ReturnType<typeof parseInteractionsCsv>['rows'][number];
type ContraRule = ReturnType<typeof parseContraindicationsCsv>['rows'][number];
type DoseRule = DoseLimitRow & { line: number; drugId: string | null; atcPrefix: string | null };
type AnyRule = Record<string, unknown> & { line: number };
