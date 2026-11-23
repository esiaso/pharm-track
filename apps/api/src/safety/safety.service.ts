import { BadRequestException, Injectable } from '@nestjs/common';
import { Drug } from '@prisma/client';
import { atcHierarchy } from '../domain/codes';
import { evaluateOverrides, runSafetyChecks } from '../domain/safety-engine';
import type { DrugFacts, PatientSafetyContext, ProposedItem, SafetyAlert, SafetyOverride, SafetyRules } from '../domain/types';
import { addDays } from '../domain/dispensing';
import { num, PrismaService } from '../prisma/prisma.service';
import { ClinicalContextDto, SafetyCheckDto } from './safety.dto';

export interface CheckLine {
  ref: string;
  drug: Drug;
  dose: number;
  doseUnit: string;
  frequencyPerDay: number;
  route: string;
}

/** Loads patient records and rules from the database and runs the pure safety engine. */
@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Real-time check used by CliniTrack's prescription pad before signing. */
  async check(dto: SafetyCheckDto) {
    const lines = await this.resolveLines(dto.items);
    const alerts = await this.evaluate(dto.patientId, dto.context, lines, dto.facilityId);
    const summary = await this.evaluateOverrides(alerts, [], dto.facilityId ?? '');
    return {
      alerts,
      canSign: summary.blocking.length === 0,
      requiresOverride: summary.unacknowledged.map((a) => a.key),
      /** Hard stops a consultant may override at this facility (with authorisedBy and a reason). */
      consultantOverridable: summary.overridable,
    };
  }

  async resolveLines(items: { ref: string; hptCode: string; dose: number; doseUnit: string; frequencyPerDay: number; route: string }[]): Promise<CheckLine[]> {
    const codes = [...new Set(items.map((i) => i.hptCode.trim().toUpperCase()))];
    const drugs = await this.prisma.drug.findMany({ where: { hptCode: { in: codes } } });
    const byHpt = new Map(drugs.map((d) => [d.hptCode, d]));
    return items.map((i) => {
      const drug = byHpt.get(i.hptCode.trim().toUpperCase());
      if (!drug) throw new BadRequestException(`Unknown HPT code ${i.hptCode} on line ${i.ref}.`);
      return { ...i, drug };
    });
  }

  /**
   * Runs all checks for the given lines. Allergies come from PharmTrack's records
   * (which include those synced from CliniTrack). Active medications are derived
   * from recent dispenses, excluding the prescription being checked.
   */
  async evaluate(
    patientId: string,
    context: ClinicalContextDto,
    lines: CheckLine[],
    facilityId?: string,
    excludePrescriptionId?: string,
  ): Promise<SafetyAlert[]> {
    const [allergies, activeMedications] = await Promise.all([
      this.prisma.allergy.findMany({ where: { patientId, status: 'ACTIVE' } }),
      this.activeMedications(patientId, excludePrescriptionId),
    ]);
    const patient: PatientSafetyContext = {
      patientId,
      ageMonths: context.ageMonths,
      weightKg: context.weightKg,
      pregnant: context.pregnant,
      lactating: context.lactating,
      crClMlMin: context.crClMlMin,
      hepaticImpairment: context.hepaticImpairment,
      diagnoses: context.diagnoses ?? [],
      allergies: allergies.map((a) => ({ ...a })),
      activeMedications,
    };
    const facilityStatus = facilityId ? await this.facilityStatuses(facilityId, lines.map((l) => l.drug.id)) : new Map();
    const items: ProposedItem[] = lines.map((l) => ({
      ref: l.ref,
      dose: l.dose,
      doseUnit: l.doseUnit,
      frequencyPerDay: l.frequencyPerDay,
      route: l.route,
      drug: toFacts(l.drug, facilityStatus.get(l.drug.id)),
    }));
    const rules = await this.loadRules([...items.map((i) => i.drug.atcCode), ...activeMedications.map((m) => m.atcCode)], items.map((i) => i.drug.id));
    return runSafetyChecks(patient, items, rules);
  }

  /** Applies overrides under the facility's policy (consultant overrides of hard stops are off unless the facility allows them). */
  async evaluateOverrides(alerts: SafetyAlert[], overrides: SafetyOverride[], facilityId: string, actorId?: string) {
    const profile = await this.prisma.facilityProfile.findUnique({ where: { facilityId }, select: { allowHardStopOverride: true } });
    return evaluateOverrides(alerts, overrides, { hardStopOverride: !!profile?.allowHardStopOverride, actorId });
  }

  /** Medicines dispensed to the patient whose supply has not yet run out. */
  private async activeMedications(patientId: string, excludePrescriptionId?: string) {
    const since = addDays(new Date(), -180);
    const lines = await this.prisma.dispenseLine.findMany({
      where: {
        dispensedAt: { gte: since },
        dispenseOrder: { prescription: { patientId, ...(excludePrescriptionId ? { id: { not: excludePrescriptionId } } : {}) } },
      },
      include: { prescriptionItem: true, drug: true },
    });
    const now = Date.now();
    const seen = new Map<string, { drugId: string; atcCode: string; genericName: string }>();
    for (const l of lines) {
      const endsAt = addDays(l.dispensedAt, l.prescriptionItem.durationDays).getTime();
      if (endsAt >= now) seen.set(l.drugId, { drugId: l.drugId, atcCode: l.atcCode, genericName: l.drug.genericName });
    }
    return [...seen.values()];
  }

  private async facilityStatuses(facilityId: string, drugIds: string[]) {
    const entries = await this.prisma.facilityFormulary.findMany({ where: { facilityId, drugId: { in: drugIds } } });
    return new Map(entries.map((e) => [e.drugId, e.status]));
  }

  /** Loads only ACTIVE rules whose ATC prefix could match one of the codes involved (draft and retired rule sets are ignored). */
  private async loadRules(atcCodes: string[], drugIds: string[]): Promise<SafetyRules> {
    const prefixes = [...new Set(atcCodes.flatMap((c) => atcHierarchy(c)))];
    const [interactions, contraindications, doseLimits] = await Promise.all([
      this.prisma.drugInteraction.findMany({ where: { status: 'ACTIVE', OR: [{ atcPrefixA: { in: prefixes } }, { atcPrefixB: { in: prefixes } }] } }),
      this.prisma.contraindication.findMany({ where: { status: 'ACTIVE', atcPrefix: { in: prefixes } } }),
      this.prisma.doseLimitRule.findMany({ where: { status: 'ACTIVE', OR: [{ drugId: { in: drugIds } }, { atcPrefix: { in: prefixes } }] } }),
    ]);
    return {
      interactions,
      contraindications,
      doseLimits: doseLimits.map((l) => ({
        ...l,
        minWeightKg: num(l.minWeightKg),
        maxWeightKg: num(l.maxWeightKg),
        crClBelow: num(l.crClBelow),
        maxSingleDose: num(l.maxSingleDose),
        maxDailyDose: num(l.maxDailyDose),
      })),
    };
  }
}

export function toFacts(d: Drug, facilityStatus?: Drug['formularyStatus']): DrugFacts {
  // Suite-wide DISCONTINUED always wins; otherwise the facility's own status applies.
  const status = d.formularyStatus === 'DISCONTINUED' ? 'DISCONTINUED' : (facilityStatus ?? d.formularyStatus);
  return {
    id: d.id,
    genericName: d.genericName,
    atcCode: d.atcCode,
    hptCode: d.hptCode,
    route: d.route,
    formularyStatus: status,
    pregnancyRisk: d.pregnancyRisk,
    lactationRisk: d.lactationRisk,
  };
}
