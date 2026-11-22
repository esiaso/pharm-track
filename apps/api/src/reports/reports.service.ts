import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { isAntimicrobial } from '../domain/codes';
import { toCsv } from '../domain/csv';
import { adrDueBy, dddCount, Encounter, indicatorsByPrescriber, monthPeriod, prescribingIndicators, round, stockOutDays, wasOutAt } from '../domain/reports';
import { OutboxService } from '../integrations/outbox.service';
import { num, PrismaService } from '../prisma/prisma.service';
import { toPpbReport } from '../records/records.service';

export interface Check {
  level: 'warning' | 'info';
  code: string;
  message: string;
  count: number;
}

type Period = { facilityId?: string; from: Date; to: Date };

const ADR_DAYS = {
  serious: Number(process.env.ADR_SERIOUS_DAYS ?? 7),
  nonSerious: Number(process.env.ADR_NON_SERIOUS_DAYS ?? 30),
};

/**
 * Operational and statutory reporting. PharmTrack does not submit to SHA or
 * DHA itself: the monthly pharmacy return goes to CliniTrack, which forwards
 * it. The stock-out report goes to SupplyTrack. ADR reports are prepared for
 * PPB and their submission is tracked here.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Live reports ──────────────────────────────────────────────────────────

  /** Consumption by drug, coded by ATC and HPT, with WHO DDDs where they can be computed. */
  async consumption(filter: Period) {
    const lines = await this.prisma.dispenseLine.findMany({
      where: { dispensedAt: { gte: filter.from, lt: filter.to }, dispenseOrder: { facilityId: filter.facilityId } },
      include: { drug: { include: { atc: true } }, dispenseOrder: { select: { kind: true } } },
    });
    type Row = { hptCode: string; atcCode: string; genericName: string; strength: string; unitOfIssue: string; quantity: number; refillQuantity: number; value: number; ddds: number | null; antimicrobial: boolean };
    const byDrug = new Map<string, Row>();
    for (const l of lines) {
      const qty = num(l.quantity)! - num(l.quantityReturned)!;
      const d = l.drug;
      const row = byDrug.get(l.hptCode) ?? {
        hptCode: l.hptCode,
        atcCode: l.atcCode,
        genericName: d.genericName,
        strength: d.strength,
        unitOfIssue: d.unitOfIssue,
        quantity: 0,
        refillQuantity: 0,
        value: 0,
        ddds: null,
        antimicrobial: isAntimicrobial(l.atcCode),
      };
      row.quantity += qty;
      row.value = round(row.value + qty * num(l.unitPrice)!, 2);
      if (l.dispenseOrder.kind === 'REFILL') row.refillQuantity += qty;
      byDrug.set(l.hptCode, row);
    }
    // DDDs on the net quantity, using the ATC code on the line (as dispensed).
    const atc = new Map((await this.prisma.atcCode.findMany({ where: { code: { in: [...new Set(lines.map((l) => l.atcCode))] } } })).map((a) => [a.code, a]));
    for (const l of lines) {
      const row = byDrug.get(l.hptCode)!;
      const a = atc.get(l.atcCode);
      row.ddds = dddCount(row.quantity, num(l.drug.strengthValue), l.drug.strengthUnit, num(a?.ddd ?? null), a?.dddUnit);
    }
    return [...byDrug.values()].sort((a, b) => a.atcCode.localeCompare(b.atcCode) || a.hptCode.localeCompare(b.hptCode));
  }

  /** Antimicrobial use grouped by ATC level-4 class (stewardship), with DDDs. */
  async antimicrobialUse(filter: Period) {
    const rows = (await this.consumption(filter)).filter((r) => r.antimicrobial);
    const byClass = new Map<string, { atcClass: string; quantity: number; ddds: number | null; productsWithoutDdd: number }>();
    for (const r of rows) {
      const k = r.atcCode.slice(0, 5);
      const c = byClass.get(k) ?? { atcClass: k, quantity: 0, ddds: null as number | null, productsWithoutDdd: 0 };
      c.quantity += r.quantity;
      if (r.ddds === null) c.productsWithoutDdd++;
      else c.ddds = round((c.ddds ?? 0) + r.ddds, 2);
      byClass.set(k, c);
    }
    return [...byClass.values()].sort((a, b) => a.atcClass.localeCompare(b.atcClass));
  }

  /** Refill timeliness for a facility: how many refills are due, overdue, completed. */
  async refillSummary(facilityId?: string) {
    const groups = await this.prisma.refillSchedule.groupBy({ by: ['status'], where: { facilityId }, _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  }

  /** Override log for audit and formulary-compliance review. */
  overrides(filter: { from: Date; to: Date }) {
    return this.prisma.safetyAlert.findMany({
      where: { raisedAt: { gte: filter.from, lt: filter.to }, overrideReason: { not: null } },
      include: { prescriptionItem: { select: { hptCode: true, atcCode: true, prescription: { select: { prescriberId: true, facilityId: true } } } } },
      orderBy: { raisedAt: 'desc' },
      take: 1000,
    });
  }

  /**
   * WHO/INRUD prescribing indicators for the facility and each prescriber, from
   * signed prescriptions (one prescription = one encounter).
   */
  async prescribing(filter: Period) {
    const rx = await this.prisma.prescription.findMany({
      where: { signedAt: { gte: filter.from, lt: filter.to }, facilityId: filter.facilityId, status: { not: 'CANCELLED' } },
      include: { items: { include: { drug: true, safetyAlerts: { where: { stage: 'PRESCRIBING', overrideReason: { not: null } }, select: { id: true } } } } },
    });
    const drugIds = [...new Set(rx.flatMap((p) => p.items.map((i) => i.drugId)))];
    const entries = await this.prisma.facilityFormulary.findMany({ where: { drugId: { in: drugIds }, facilityId: filter.facilityId ? filter.facilityId : { in: [...new Set(rx.map((p) => p.facilityId))] } } });
    const facStatus = new Map(entries.map((e) => [`${e.facilityId}|${e.drugId}`, e.status]));
    const encounters: Encounter[] = rx.map((p) => ({
      prescriberId: p.prescriberId,
      overrides: p.items.reduce((s, i) => s + i.safetyAlerts.length, 0),
      items: p.items.map((i) => {
        const status = i.drug.formularyStatus === 'DISCONTINUED' ? 'DISCONTINUED' : (facStatus.get(`${p.facilityId}|${i.drugId}`) ?? i.drug.formularyStatus);
        return { atcCode: i.atcCode, route: i.route, onFormulary: status === 'ACTIVE' || status === 'RESTRICTED' };
      }),
    }));
    return { from: filter.from, to: filter.to, facilityId: filter.facilityId ?? null, facility: prescribingIndicators(encounters), prescribers: indicatorsByPrescriber(encounters) };
  }

  /** Stock-outs in the period for the stores a facility dispenses from. */
  async stockOuts(filter: Period & { storeId?: string }) {
    const storeIds = filter.storeId
      ? [filter.storeId]
      : filter.facilityId
        ? (await this.prisma.dispenseOrder.findMany({ where: { facilityId: filter.facilityId }, distinct: ['storeId'], select: { storeId: true } })).map((s) => s.storeId)
        : undefined;
    const episodes = await this.prisma.stockOutEpisode.findMany({
      where: { storeId: storeIds ? { in: storeIds } : undefined, startedAt: { lt: filter.to }, OR: [{ endedAt: null }, { endedAt: { gt: filter.from } }] },
      orderBy: { startedAt: 'asc' },
    });
    const groups = new Map<string, typeof episodes>();
    for (const e of episodes) groups.set(`${e.storeId}|${e.hptCode}`, [...(groups.get(`${e.storeId}|${e.hptCode}`) ?? []), e]);
    const hpts = [...new Set(episodes.map((e) => e.hptCode))];
    const drugs = new Map((await this.prisma.drug.findMany({ where: { hptCode: { in: hpts } } })).map((d) => [d.hptCode, d]));
    // Prescription items for the item at that store, signed while it was out of stock.
    const items = await this.prisma.prescriptionItem.findMany({
      where: { hptCode: { in: hpts }, prescription: { signedAt: { gte: filter.from, lt: filter.to }, storeId: storeIds ? { in: storeIds } : undefined, facilityId: filter.facilityId } },
      select: { hptCode: true, prescription: { select: { storeId: true, signedAt: true } } },
    });
    const now = new Date();
    const rows = [...groups.entries()].map(([key, eps]) => {
      const [storeId, hptCode] = key.split('|') as [string, string];
      const d = drugs.get(hptCode);
      return {
        storeId,
        hptCode,
        genericName: d?.genericName ?? null,
        strength: d?.strength ?? null,
        episodes: eps.length,
        daysOut: stockOutDays(eps, filter.from, filter.to, now),
        outAtEnd: wasOutAt(eps, new Date(Math.min(filter.to.getTime(), now.getTime()) - 1)),
        prescriptionItemsAffected: items.filter((i) => i.hptCode === hptCode && i.prescription.storeId === storeId && wasOutAt(eps, i.prescription.signedAt)).length,
        firstOutAt: eps[0]!.startedAt,
      };
    });
    return rows.sort((a, b) => b.daysOut - a.daysOut || a.hptCode.localeCompare(b.hptCode));
  }

  // ── ADR reporting to PPB ──────────────────────────────────────────────────

  /** ADRs not yet submitted to PPB, with the internal target date for each. */
  async adrQueue() {
    const adrs = await this.prisma.adverseDrugReaction.findMany({
      where: { ppbReportStatus: { in: ['NOT_SUBMITTED', 'EXPORTED'] } },
      include: { drug: { select: { genericName: true, strength: true, hptCode: true, atcCode: true } } },
      orderBy: { reportedAt: 'asc' },
    });
    const now = Date.now();
    const rows = adrs.map((a) => {
      const dueBy = adrDueBy(a.reportedAt, a.seriousness, ADR_DAYS);
      return { ...a, dueBy, overdue: dueBy.getTime() < now, serious: a.seriousness !== 'NON_SERIOUS' };
    });
    const [submitted, acknowledged] = await Promise.all([
      this.prisma.adverseDrugReaction.count({ where: { ppbReportStatus: 'SUBMITTED' } }),
      this.prisma.adverseDrugReaction.count({ where: { ppbReportStatus: 'ACKNOWLEDGED' } }),
    ]);
    return { targets: ADR_DAYS, pending: rows, counts: { pending: rows.length, overdue: rows.filter((r) => r.overdue).length, submitted, acknowledged } };
  }

  /** Several ADRs in the PPB report format in one file. Marks them EXPORTED. */
  async adrBatch(ids: string[], actor: Actor) {
    const adrs = await this.prisma.adverseDrugReaction.findMany({ where: { id: { in: ids } }, include: { drug: true }, orderBy: { reportedAt: 'asc' } });
    const missing = ids.filter((id) => !adrs.some((a) => a.id === id));
    if (missing.length) throw new NotFoundException(`ADR not found: ${missing.join(', ')}`);
    const toMark = adrs.filter((a) => a.ppbReportStatus === 'NOT_SUBMITTED').map((a) => a.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.adverseDrugReaction.updateMany({ where: { id: { in: toMark } }, data: { ppbReportStatus: 'EXPORTED' } });
      for (const id of toMark) await this.audit.log(tx, actor, 'adr.export', 'AdverseDrugReaction', id);
    });
    return { generatedAt: new Date().toISOString(), count: adrs.length, reports: adrs.map((a) => toPpbReport(a, a.drug)) };
  }

  // ── Monthly report runs ───────────────────────────────────────────────────

  async listRuns(filter: { kind?: 'PHARMACY_RETURN' | 'STOCK_OUT'; facilityId?: string }) {
    const runs = await this.prisma.reportRun.findMany({
      where: { kind: filter.kind, facilityId: filter.facilityId },
      omit: { data: true },
      orderBy: [{ period: 'desc' }, { generatedAt: 'desc' }],
      take: 200,
    });
    return this.withDelivery(runs);
  }

  async getRun(id: string) {
    const run = await this.prisma.reportRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Report ${id} not found.`);
    return (await this.withDelivery([run]))[0]!;
  }

  /** Adds the delivery state of each submitted run's outgoing message (PENDING, DELIVERED or DEAD). */
  private async withDelivery<T extends { id: string }>(runs: T[]): Promise<(T & { delivery: string | null })[]> {
    const events = await this.prisma.outboxEvent.findMany({ where: { idempotencyKey: { in: runs.map((r) => `report:${r.id}`) } }, select: { idempotencyKey: true, status: true } });
    const status = new Map(events.map((e) => [e.idempotencyKey, e.status]));
    return runs.map((r) => ({ ...r, delivery: status.get(`report:${r.id}`) ?? null }));
  }

  /**
   * Builds the report for a facility and month and keeps it as a draft. A
   * period that already has a draft gets it replaced; a period already
   * submitted gets a new draft that, once submitted, amends the earlier one.
   */
  async generate(kind: 'PHARMACY_RETURN' | 'STOCK_OUT', facilityId: string, period: string, actor: Actor) {
    let range: { from: Date; to: Date };
    try {
      range = monthPeriod(period);
    } catch (e) {
      throw new UnprocessableEntityException((e as Error).message);
    }
    if (range.from.getTime() > Date.now()) throw new UnprocessableEntityException('That month has not started yet.');
    const built = kind === 'PHARMACY_RETURN' ? await this.buildPharmacyReturn(facilityId, range) : await this.buildStockOutReport(facilityId, range);
    const key = { kind, facilityId, period };
    const submittedCount = await this.prisma.reportRun.count({ where: { ...key, status: { in: ['SUBMITTED', 'SUPERSEDED'] } } });
    const draft = await this.prisma.reportRun.findFirst({ where: { ...key, status: 'DRAFT' } });
    const data = {
      data: built.data as Prisma.InputJsonValue,
      summary: built.summary as Prisma.InputJsonValue,
      checks: built.checks as unknown as Prisma.InputJsonValue,
      periodFrom: range.from,
      periodTo: range.to,
      generatedBy: actor.id,
      generatedAt: new Date(),
    };
    const run = draft
      ? await this.prisma.reportRun.update({ where: { id: draft.id }, data })
      : await this.prisma.reportRun.create({ data: { ...key, ...data, version: submittedCount + 1 } });
    await this.audit.log(this.prisma, actor, 'report.generate', 'ReportRun', run.id, undefined, { kind, facilityId, period, version: run.version });
    return run;
  }

  async discard(id: string, actor: Actor) {
    const run = await this.getRun(id);
    if (run.status !== 'DRAFT') throw new ConflictException('Only a draft can be discarded; a submitted report stays on record.');
    await this.prisma.reportRun.delete({ where: { id } });
    await this.audit.log(this.prisma, actor, 'report.discard', 'ReportRun', id, { kind: run.kind, period: run.period }, undefined);
    return { id, discarded: true };
  }

  async submit(id: string, acknowledgeWarnings: boolean, actor: Actor) {
    const run = await this.getRun(id);
    if (run.status !== 'DRAFT') throw new ConflictException(`This report is already ${run.status.toLowerCase()}.`);
    const warnings = (run.checks as unknown as Check[]).filter((c) => c.level === 'warning');
    if (warnings.length && !acknowledgeWarnings)
      throw new UnprocessableEntityException({ message: 'The report has data-quality warnings. Fix them and regenerate, or confirm you want to submit anyway.', warnings });
    const ageMs = Date.now() - run.generatedAt.getTime();
    if (ageMs > 24 * 3_600_000) throw new ConflictException('This draft is more than a day old. Regenerate it so it includes the latest data, then submit.');

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.reportRun.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedBy: actor.id, submittedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('This report was changed by someone else. Reload and try again.');
      const previous = await tx.reportRun.findFirst({ where: { kind: run.kind, facilityId: run.facilityId, period: run.period, status: 'SUBMITTED', id: { not: id } } });
      if (previous) await tx.reportRun.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED' } });
      const updated = await tx.reportRun.update({ where: { id }, data: { amendsId: previous?.id ?? null } });
      const payload = {
        reportId: id,
        reportType: run.kind,
        facilityId: run.facilityId,
        period: run.period,
        periodFrom: run.periodFrom.toISOString(),
        periodTo: run.periodTo.toISOString(),
        version: run.version,
        amendsReportId: previous?.id ?? null,
        generatedAt: run.generatedAt.toISOString(),
        submittedBy: actor.id,
        summary: run.summary,
        data: run.data,
      };
      if (run.kind === 'PHARMACY_RETURN') await this.outbox.enqueue(tx, 'CLINITRACK', 'report.submitted', `report:${id}`, payload);
      else await this.outbox.enqueue(tx, 'SUPPLYTRACK', 'stockout.report', `report:${id}`, payload);
      await this.audit.log(tx, actor, 'report.submit', 'ReportRun', id, { status: 'DRAFT' }, { status: 'SUBMITTED', amends: previous?.id ?? null, acknowledgedWarnings: warnings.map((w) => w.code) });
      return updated;
    });
  }

  /** The run's main table as CSV (consumption lines or stock-out items). */
  async runCsv(id: string): Promise<{ filename: string; csv: string }> {
    const run = await this.getRun(id);
    const data = run.data as any;
    const name = `${run.kind.toLowerCase().replace('_', '-')}-${run.facilityId}-${run.period}-v${run.version}.csv`.replace(/[^A-Za-z0-9.-]+/g, '-');
    if (run.kind === 'PHARMACY_RETURN') return { filename: name, csv: consumptionCsv(data.consumption) };
    return { filename: name, csv: stockOutCsv(data.items) };
  }

  private async buildPharmacyReturn(facilityId: string, range: { from: Date; to: Date }) {
    const filter = { facilityId, ...range };
    const [consumption, antimicrobials] = await Promise.all([this.consumption(filter), this.antimicrobialUse(filter)]);
    const lineWhere = { dispensedAt: { gte: range.from, lt: range.to }, dispenseOrder: { facilityId } };
    const [lines, failedBilling, pendingBilling, refillOrders, schedulesStarted, overdue, adrs, retired, codeReleases] = await Promise.all([
      this.prisma.dispenseLine.count({ where: lineWhere }),
      this.prisma.dispenseLine.count({ where: { ...lineWhere, billingStatus: 'FAILED' } }),
      this.prisma.dispenseLine.count({ where: { ...lineWhere, billingStatus: 'PENDING', dispensedAt: { gte: range.from, lt: new Date(Math.min(range.to.getTime(), Date.now() - 3_600_000)) } } }),
      this.prisma.dispenseOrder.count({ where: { facilityId, kind: 'REFILL', lines: { some: { dispensedAt: { gte: range.from, lt: range.to } } } } }),
      this.prisma.refillSchedule.count({ where: { facilityId, createdAt: { gte: range.from, lt: range.to } } }),
      this.prisma.refillSchedule.count({ where: { facilityId, status: 'OVERDUE' } }),
      this.prisma.adverseDrugReaction.groupBy({
        by: ['seriousness'],
        where: { reportedAt: { gte: range.from, lt: range.to }, dispenseLineId: { in: (await this.prisma.dispenseLine.findMany({ where: { dispenseOrder: { facilityId } }, select: { id: true } })).map((l) => l.id) } },
        _count: { _all: true },
      }),
      this.prisma.dispenseLine.findMany({
        where: { ...lineWhere, OR: [{ drug: { atc: { retiredInRelease: { not: null } } } }, { drug: { hpt: { retiredInRelease: { not: null } } } }] },
        distinct: ['hptCode'],
        select: { hptCode: true },
      }),
      this.prisma.codeSetImport.findMany({ where: { codeSystem: { in: ['WHO_ATC', 'PPB_HPT'] } }, orderBy: { importedAt: 'desc' }, distinct: ['codeSystem'], select: { codeSystem: true, release: true } }),
    ]);
    const withDdd = consumption.filter((r) => r.ddds !== null);
    const amNoDdd = consumption.filter((r) => r.antimicrobial && r.ddds === null);
    const checks: Check[] = [];
    if (failedBilling) checks.push({ level: 'warning', code: 'BILLING_FAILED', message: 'Dispensed lines that CliniTrack never accepted for billing. Retry them from Integrations.', count: failedBilling });
    if (pendingBilling) checks.push({ level: 'warning', code: 'BILLING_PENDING', message: 'Dispensed lines still waiting to reach CliniTrack after an hour.', count: pendingBilling });
    if (retired.length) checks.push({ level: 'warning', code: 'RETIRED_CODES', message: 'Products dispensed under an ATC or HPT code that has since been retired. Re-code them in Clinical content.', count: retired.length });
    if (amNoDdd.length) checks.push({ level: 'info', code: 'ANTIMICROBIAL_NO_DDD', message: 'Antimicrobial products without a DDD (no WHO DDD loaded, or strength units that do not convert). Their DDDs are left out.', count: amNoDdd.length });
    if (!lines) checks.push({ level: 'info', code: 'NO_DISPENSING', message: 'Nothing was dispensed at this facility in the period.', count: 0 });

    const sum = (f: (r: (typeof consumption)[number]) => number) => round(consumption.reduce((s, r) => s + f(r), 0), 2);
    const summary = {
      dispenseLines: lines,
      products: consumption.length,
      quantity: sum((r) => r.quantity),
      value: sum((r) => r.value),
      ddds: round(withDdd.reduce((s, r) => s + (r.ddds ?? 0), 0), 2),
      antimicrobialDdds: round(antimicrobials.reduce((s, c) => s + (c.ddds ?? 0), 0), 2),
      refillsDispensed: refillOrders,
      adrsReported: adrs.reduce((s, a) => s + a._count._all, 0),
    };
    const data = {
      codeSystems: Object.fromEntries(codeReleases.map((c) => [c.codeSystem, c.release])),
      consumption,
      antimicrobials,
      refills: { schedulesStarted, refillsDispensed: refillOrders, overdueNow: overdue },
      adrs: adrs.map((a) => ({ seriousness: a.seriousness, count: a._count._all })),
    };
    return { data, summary, checks };
  }

  private async buildStockOutReport(facilityId: string, range: { from: Date; to: Date }) {
    const items = await this.stockOuts({ facilityId, ...range });
    const checks: Check[] = [];
    const unknown = items.filter((i) => !i.genericName);
    if (unknown.length) checks.push({ level: 'info', code: 'UNKNOWN_ITEMS', message: 'Stock-outs for HPT codes that are not in the drug master.', count: unknown.length });
    if (!items.length) checks.push({ level: 'info', code: 'NO_STOCKOUTS', message: 'SupplyTrack reported no stock-outs for this facility in the period.', count: 0 });
    const summary = {
      itemsOut: items.length,
      totalDaysOut: round(items.reduce((s, i) => s + i.daysOut, 0), 1),
      stillOut: items.filter((i) => i.outAtEnd).length,
      prescriptionItemsAffected: items.reduce((s, i) => s + i.prescriptionItemsAffected, 0),
    };
    return { data: { items }, summary, checks };
  }
}

export function consumptionCsv(rows: { hptCode: string; atcCode: string; genericName: string; strength: string; unitOfIssue?: string; quantity: number; refillQuantity: number; value: number; ddds: number | null; antimicrobial: boolean }[]) {
  return toCsv(
    ['hpt_code', 'atc_code', 'generic_name', 'strength', 'unit_of_issue', 'quantity', 'refill_quantity', 'value', 'ddds', 'antimicrobial'],
    rows.map((r) => ({ hpt_code: r.hptCode, atc_code: r.atcCode, generic_name: r.genericName, strength: r.strength, unit_of_issue: r.unitOfIssue, quantity: r.quantity, refill_quantity: r.refillQuantity, value: r.value, ddds: r.ddds, antimicrobial: r.antimicrobial ? 'yes' : 'no' })),
  );
}

export function stockOutCsv(rows: { storeId: string; hptCode: string; genericName: string | null; strength: string | null; episodes: number; daysOut: number; outAtEnd: boolean; prescriptionItemsAffected: number }[]) {
  return toCsv(
    ['store_id', 'hpt_code', 'generic_name', 'strength', 'episodes', 'days_out', 'out_at_end', 'prescription_items_affected'],
    rows.map((r) => ({ store_id: r.storeId, hpt_code: r.hptCode, generic_name: r.genericName, strength: r.strength, episodes: r.episodes, days_out: r.daysOut, out_at_end: r.outAtEnd ? 'yes' : 'no', prescription_items_affected: r.prescriptionItemsAffected })),
  );
}

export function prescribingCsv(rows: ({ prescriberId: string } & Record<string, number | string>)[]) {
  const headers = ['prescriberId', 'encounters', 'items', 'avgMedicinesPerEncounter', 'pctEncountersWithAntibiotic', 'pctEncountersWithInjection', 'pctItemsOnFormulary', 'pctEncountersWithAntimicrobial', 'overridesPer100Items'];
  return toCsv(headers, rows);
}
