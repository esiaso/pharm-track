import { Injectable } from '@nestjs/common';
import { isAntimicrobial } from '../domain/codes';
import { num, PrismaService } from '../prisma/prisma.service';

/**
 * Operational reports. Claims and statutory reporting to SHA/DHA go through
 * CliniTrack, which receives every billable line with its ATC and HPT codes;
 * these endpoints also give CliniTrack (and pharmacy managers) coded extracts.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Consumption by drug, coded by ATC and HPT, with antimicrobial flag. */
  async consumption(filter: { facilityId?: string; from: Date; to: Date }) {
    const lines = await this.prisma.dispenseLine.findMany({
      where: { dispensedAt: { gte: filter.from, lt: filter.to }, dispenseOrder: { facilityId: filter.facilityId } },
      include: { drug: true, dispenseOrder: { select: { kind: true } } },
    });
    const byDrug = new Map<string, { hptCode: string; atcCode: string; genericName: string; strength: string; quantity: number; value: number; refillQuantity: number; antimicrobial: boolean }>();
    for (const l of lines) {
      const qty = num(l.quantity)! - num(l.quantityReturned)!;
      const row = byDrug.get(l.hptCode) ?? {
        hptCode: l.hptCode,
        atcCode: l.atcCode,
        genericName: l.drug.genericName,
        strength: l.drug.strength,
        quantity: 0,
        value: 0,
        refillQuantity: 0,
        antimicrobial: isAntimicrobial(l.atcCode),
      };
      row.quantity += qty;
      row.value += qty * num(l.unitPrice)!;
      if (l.dispenseOrder.kind === 'REFILL') row.refillQuantity += qty;
      byDrug.set(l.hptCode, row);
    }
    return [...byDrug.values()].sort((a, b) => a.atcCode.localeCompare(b.atcCode));
  }

  /** Antimicrobial use grouped by ATC level-4 class (stewardship). */
  async antimicrobialUse(filter: { facilityId?: string; from: Date; to: Date }) {
    const rows = (await this.consumption(filter)).filter((r) => r.antimicrobial);
    const byClass = new Map<string, number>();
    for (const r of rows) byClass.set(r.atcCode.slice(0, 5), (byClass.get(r.atcCode.slice(0, 5)) ?? 0) + r.quantity);
    return [...byClass.entries()].map(([atcClass, quantity]) => ({ atcClass, quantity }));
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
}
