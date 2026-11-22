import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Drug, Prisma } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { atcHierarchy, atcLevel, atcParent, isValidAtc, isValidHptFormat, normaliseAtc, normaliseHpt } from '../domain/codes';
import { OutboxService } from '../integrations/outbox.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CreateDrugDto, FacilityFormularyDto, ImportAtcDto, ImportHptDto, SearchDrugsQuery, SetPriceDto, UpdateDrugDto } from './formulary.dto';

@Injectable()
export class FormularyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Drug master ───────────────────────────────────────────────────────────

  async createDrug(dto: CreateDrugDto, actor: Actor): Promise<Drug> {
    const hptCode = normaliseHpt(dto.hptCode);
    const atcCode = normaliseAtc(dto.atcCode);
    await this.assertCodes(this.prisma, atcCode, hptCode);
    if (await this.prisma.drug.findUnique({ where: { hptCode } })) {
      throw new ConflictException(`A drug with HPT code ${hptCode} already exists.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const drug = await tx.drug.create({ data: { ...dto, hptCode, atcCode, brandNames: dto.brandNames ?? [] } });
      await tx.drugVersion.create({ data: { drugId: drug.id, version: 1, snapshot: snapshot(drug), changedBy: actor.id, reason: 'created' } });
      await this.audit.log(tx, actor, 'drug.create', 'Drug', drug.id, undefined, drug);
      await this.publishDrug(tx, drug);
      return drug;
    });
  }

  async updateDrug(id: string, dto: UpdateDrugDto, actor: Actor): Promise<Drug> {
    const { reason, ...changes } = dto;
    const before = await this.getDrug(id);
    if (changes.atcCode) {
      changes.atcCode = normaliseAtc(changes.atcCode);
      await this.assertCodes(this.prisma, changes.atcCode, before.hptCode);
    }
    return this.prisma.$transaction(async (tx) => {
      const drug = await tx.drug.update({ where: { id }, data: { ...changes, version: { increment: 1 } } });
      await tx.drugVersion.create({ data: { drugId: id, version: drug.version, snapshot: snapshot(drug), changedBy: actor.id, reason } });
      await this.audit.log(tx, actor, 'drug.update', 'Drug', id, before, drug);
      await this.publishDrug(tx, drug);
      return drug;
    });
  }

  async getDrug(id: string): Promise<Drug> {
    const drug = await this.prisma.drug.findUnique({ where: { id } });
    if (!drug) throw new NotFoundException(`Drug ${id} not found.`);
    return drug;
  }

  async getByHpt(hptCode: string) {
    const drug = await this.prisma.drug.findUnique({
      where: { hptCode: normaliseHpt(hptCode) },
      include: { atc: true, substitutionGroup: true },
    });
    if (!drug) throw new NotFoundException(`No drug with HPT code ${hptCode}.`);
    return { ...drug, atcHierarchy: atcHierarchy(drug.atcCode) };
  }

  versions(id: string) {
    return this.prisma.drugVersion.findMany({ where: { drugId: id }, orderBy: { version: 'desc' } });
  }

  /**
   * Search by generic or brand name, ATC code / class prefix, or HPT code.
   * When facilityId is given, the facility's own formulary status is returned too.
   */
  async search(q: SearchDrugsQuery) {
    const term = (q.q ?? '').trim();
    const upper = term.toUpperCase();
    const where: Prisma.DrugWhereInput = {
      ...(q.includeInactive ? {} : { formularyStatus: { not: 'DISCONTINUED' } }),
      ...(term
        ? {
            OR: [
              { genericName: { contains: term, mode: 'insensitive' } },
              { brandNames: { has: term } },
              ...(atcLevel(upper) !== null ? [{ atcCode: { startsWith: upper } }] : []),
              { hptCode: upper },
              { atc: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const drugs = await this.prisma.drug.findMany({
      where,
      take: Math.min(q.limit ?? 25, 100),
      orderBy: { genericName: 'asc' },
      include: q.facilityId ? { facilityEntries: { where: { facilityId: q.facilityId } } } : undefined,
    });
    return drugs.map((d) => {
      const entry = (d as Drug & { facilityEntries?: { status: string; approvalRequiredBy: string | null }[] }).facilityEntries?.[0];
      return {
        ...d,
        facilityEntries: undefined,
        facilityStatus: entry?.status ?? null,
        approvalRequiredBy: entry?.approvalRequiredBy ?? null,
      };
    });
  }

  /** Active drugs in the same generic substitution group. */
  async substitutes(id: string) {
    const drug = await this.getDrug(id);
    if (!drug.substitutionGroupId) return [];
    return this.prisma.drug.findMany({
      where: { substitutionGroupId: drug.substitutionGroupId, id: { not: id }, formularyStatus: { in: ['ACTIVE', 'RESTRICTED'] } },
    });
  }

  // ── Facility formulary and prices ─────────────────────────────────────────

  async setFacilityEntry(facilityId: string, drugId: string, dto: FacilityFormularyDto, actor: Actor) {
    await this.getDrug(drugId);
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.facilityFormulary.upsert({
        where: { facilityId_drugId: { facilityId, drugId } },
        create: { facilityId, drugId, ...dto },
        update: dto,
      });
      await this.audit.log(tx, actor, 'facility-formulary.set', 'FacilityFormulary', entry.id, undefined, entry);
      return entry;
    });
  }

  async setPrice(drugId: string, dto: SetPriceDto, actor: Actor) {
    const drug = await this.getDrug(drugId);
    const priceListCode = dto.priceListCode ?? 'DEFAULT';
    const effectiveFrom = new Date(dto.effectiveFrom);
    return this.prisma.$transaction(async (tx) => {
      await tx.drugPrice.updateMany({
        where: { drugId, priceListCode, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
        data: { effectiveTo: effectiveFrom },
      });
      const price = await tx.drugPrice.create({
        data: { drugId, priceListCode, unitPrice: dto.unitPrice, currency: dto.currency ?? 'KES', effectiveFrom },
      });
      await this.audit.log(tx, actor, 'drug-price.set', 'DrugPrice', price.id, undefined, price);
      await this.outbox.enqueue(tx, 'CLINITRACK', 'price.updated', `price.updated:${price.id}`, {
        hptCode: drug.hptCode,
        atcCode: drug.atcCode,
        genericName: drug.genericName,
        strength: drug.strength,
        unitOfIssue: drug.unitOfIssue,
        priceListCode,
        unitPrice: dto.unitPrice,
        currency: price.currency,
        effectiveFrom: effectiveFrom.toISOString(),
      });
      return price;
    });
  }

  /** Current unit price on a price list, falling back to DEFAULT. */
  async currentPrice(tx: Tx | PrismaService, drugId: string, priceListCode = 'DEFAULT', at = new Date()) {
    for (const list of priceListCode === 'DEFAULT' ? ['DEFAULT'] : [priceListCode, 'DEFAULT']) {
      const p = await tx.drugPrice.findFirst({
        where: { drugId, priceListCode: list, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (p) return p;
    }
    return null;
  }

  // ── Reference code sets ───────────────────────────────────────────────────

  async importAtc(dto: ImportAtcDto, actor: Actor) {
    const errors: { code: string; error: string }[] = [];
    let created = 0;
    let updated = 0;
    // Parents first, so the hierarchy foreign key is always satisfied.
    const rows = dto.rows
      .map((r) => ({ ...r, code: normaliseAtc(r.code) }))
      .sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
    for (const r of rows) {
      const level = atcLevel(r.code);
      if (level === null) {
        errors.push({ code: r.code, error: 'Invalid ATC code' });
        continue;
      }
      const parentCode = atcParent(r.code);
      if (parentCode && !(await this.prisma.atcCode.findUnique({ where: { code: parentCode } }))) {
        errors.push({ code: r.code, error: `Parent ${parentCode} missing` });
        continue;
      }
      const data = { level, name: r.name, parentCode, ddd: r.ddd, dddUnit: r.dddUnit, dddRoute: r.dddRoute, release: dto.release };
      const existed = await this.prisma.atcCode.findUnique({ where: { code: r.code } });
      await this.prisma.atcCode.upsert({ where: { code: r.code }, create: { code: r.code, ...data }, update: data });
      existed ? updated++ : created++;
    }
    return this.recordImport('WHO_ATC', dto.release, dto.rows.length, created, updated, errors, actor);
  }

  async importHpt(dto: ImportHptDto, actor: Actor) {
    const errors: { code: string; error: string }[] = [];
    let created = 0;
    let updated = 0;
    for (const r of dto.rows) {
      const code = normaliseHpt(r.code);
      if (!isValidHptFormat(code)) {
        errors.push({ code, error: 'Invalid HPT code format' });
        continue;
      }
      const data = { description: r.description, category: r.category, ppbStatus: r.ppbStatus, release: dto.release };
      const existed = await this.prisma.hptCode.findUnique({ where: { code } });
      await this.prisma.hptCode.upsert({ where: { code }, create: { code, ...data }, update: data });
      existed ? updated++ : created++;
    }
    return this.recordImport('PPB_HPT', dto.release, dto.rows.length, created, updated, errors, actor);
  }

  private async recordImport(
    codeSystem: 'WHO_ATC' | 'PPB_HPT',
    release: string,
    total: number,
    created: number,
    updated: number,
    errors: { code: string; error: string }[],
    actor: Actor,
  ) {
    const rec = await this.prisma.codeSetImport.create({
      data: {
        codeSystem,
        release,
        rowsTotal: total,
        rowsCreated: created,
        rowsUpdated: updated,
        rowsFailed: errors.length,
        importedBy: actor.id,
        errors: errors.length ? errors.slice(0, 500) : undefined,
      },
    });
    await this.audit.log(this.prisma, actor, 'codeset.import', 'CodeSetImport', rec.id, undefined, { codeSystem, release, created, updated, failed: errors.length });
    return { ...rec, errors };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async assertCodes(db: Tx | PrismaService, atcCode: string, hptCode: string) {
    if (!isValidAtc(atcCode, 5)) throw new BadRequestException(`ATC code ${atcCode} must be a valid level-5 WHO ATC code.`);
    if (!isValidHptFormat(hptCode)) throw new BadRequestException(`HPT code ${hptCode} is not in the expected PPB format.`);
    if (!(await db.atcCode.findUnique({ where: { code: atcCode } })))
      throw new BadRequestException(`ATC code ${atcCode} is not in the imported WHO ATC code set.`);
    if (!(await db.hptCode.findUnique({ where: { code: hptCode } })))
      throw new BadRequestException(`HPT code ${hptCode} is not in the imported PPB HPT code set.`);
  }

  /** Keeps CliniTrack's prescription-pad catalogue in step with the master. */
  private publishDrug(tx: Tx, drug: Drug) {
    return this.outbox.enqueue(tx, 'CLINITRACK', 'drug.upserted', `drug.upserted:${drug.id}:v${drug.version}`, {
      drugId: drug.id,
      hptCode: drug.hptCode,
      atcCode: drug.atcCode,
      genericName: drug.genericName,
      brandNames: drug.brandNames,
      strength: drug.strength,
      dosageForm: drug.dosageForm,
      route: drug.route,
      unitOfIssue: drug.unitOfIssue,
      formularyStatus: drug.formularyStatus,
      controlledSchedule: drug.controlledSchedule,
      version: drug.version,
    });
  }
}

function snapshot(drug: Drug): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(drug)) as Prisma.InputJsonValue;
}
