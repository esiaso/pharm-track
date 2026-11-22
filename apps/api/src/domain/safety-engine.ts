import { atcChemicalSubgroup, atcMatches } from './codes';
import type {
  AlertSeverity,
  DoseLimit,
  PatientSafetyContext,
  ProposedItem,
  SafetyAlert,
  SafetyOverride,
  SafetyRules,
} from './types';

/**
 * Pure medication-safety engine. Given a patient context, the items being
 * prescribed (or verified) and the rule base, returns graded alerts.
 *
 * Used by CliniTrack's prescription pad (real-time check before signing) and
 * again by PharmTrack at pharmacist verification.
 */
export function runSafetyChecks(
  patient: PatientSafetyContext,
  items: ProposedItem[],
  rules: SafetyRules,
): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];
  for (const item of items) {
    alerts.push(
      ...checkFormulary(item),
      ...checkAllergies(patient, item),
      ...checkContraindications(patient, item, rules),
      ...checkDoseLimits(patient, item, rules.doseLimits),
      ...checkReproductive(patient, item),
    );
  }
  alerts.push(...checkInteractions(patient, items, rules), ...checkDuplicateTherapy(patient, items));
  return dedupe(alerts);
}

function checkFormulary(item: ProposedItem): SafetyAlert[] {
  const { drug } = item;
  const base = { itemRef: item.ref, type: 'FORMULARY' as const, key: `FORMULARY:${item.ref}:${drug.id}` };
  switch (drug.formularyStatus) {
    case 'DISCONTINUED':
      return [{ ...base, severity: 'HARD_STOP', message: `${drug.genericName} is discontinued and cannot be prescribed.` }];
    case 'NON_FORMULARY':
      return [{ ...base, severity: 'WARNING', message: `${drug.genericName} is not on the formulary.` }];
    case 'RESTRICTED':
      return [{ ...base, severity: 'WARNING', message: `${drug.genericName} is a restricted drug and needs approval.` }];
    default:
      return [];
  }
}

function checkAllergies(patient: PatientSafetyContext, item: ProposedItem): SafetyAlert[] {
  const out: SafetyAlert[] = [];
  for (const a of patient.allergies) {
    if (a.agentType === 'NON_DRUG' || a.verificationStatus === 'REFUTED') continue;
    const byDrug = a.drugId != null && a.drugId === item.drug.id;
    const byClass = a.atcPrefix != null && atcMatches(a.atcPrefix, item.drug.atcCode);
    if (!byDrug && !byClass) continue;
    const severe = a.severity === 'SEVERE' || a.severity === 'LIFE_THREATENING';
    const severity: AlertSeverity = severe && a.verificationStatus === 'CONFIRMED' ? 'HARD_STOP' : 'WARNING';
    out.push({
      key: `ALLERGY:${item.ref}:${a.id}`,
      itemRef: item.ref,
      type: 'ALLERGY',
      severity,
      message: `Patient has a recorded ${a.severity.toLowerCase().replace('_', '-')} allergy to ${a.agentText}${
        byClass && !byDrug ? ` (same class as ${item.drug.genericName})` : ''
      }.`,
    });
  }
  return out;
}

function checkContraindications(patient: PatientSafetyContext, item: ProposedItem, rules: SafetyRules): SafetyAlert[] {
  const out: SafetyAlert[] = [];
  for (const r of rules.contraindications) {
    if (!atcMatches(r.atcPrefix, item.drug.atcCode)) continue;
    const dx = patient.diagnoses.find(
      (d) => d.system === r.diagnosisSystem && d.code.toUpperCase().startsWith(r.diagnosisPrefix.toUpperCase()),
    );
    if (!dx) continue;
    out.push({
      key: `CONTRAINDICATION:${item.ref}:${r.id}`,
      itemRef: item.ref,
      type: 'CONTRAINDICATION',
      severity: r.severity,
      message: `${item.drug.genericName} is contraindicated with diagnosis ${dx.code}: ${r.rationale}`,
    });
  }
  return out;
}

const INTERACTION_SEVERITY: Record<string, AlertSeverity> = {
  MINOR: 'INFO',
  MODERATE: 'WARNING',
  MAJOR: 'WARNING',
  CONTRAINDICATED: 'HARD_STOP',
};

function checkInteractions(patient: PatientSafetyContext, items: ProposedItem[], rules: SafetyRules): SafetyAlert[] {
  const out: SafetyAlert[] = [];
  const pairMatches = (a: string, b: string, pa: string, pb: string) =>
    (atcMatches(pa, a) && atcMatches(pb, b)) || (atcMatches(pb, a) && atcMatches(pa, b));

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    // Against the other proposed items (each pair once).
    for (let j = i + 1; j < items.length; j++) {
      const other = items[j]!;
      for (const r of rules.interactions) {
        if (!pairMatches(item.drug.atcCode, other.drug.atcCode, r.atcPrefixA, r.atcPrefixB)) continue;
        out.push({
          key: `INTERACTION:${item.ref}:${other.ref}:${r.id}`,
          itemRef: item.ref,
          type: 'INTERACTION',
          severity: INTERACTION_SEVERITY[r.severity]!,
          message: `${item.drug.genericName} + ${other.drug.genericName}: ${r.description}${r.management ? ` ${r.management}` : ''}`,
        });
      }
    }
    // Against current medications.
    for (const med of patient.activeMedications) {
      if (med.drugId === item.drug.id) continue; // handled by duplicate therapy
      for (const r of rules.interactions) {
        if (!pairMatches(item.drug.atcCode, med.atcCode, r.atcPrefixA, r.atcPrefixB)) continue;
        out.push({
          key: `INTERACTION:${item.ref}:active-${med.drugId}:${r.id}`,
          itemRef: item.ref,
          type: 'INTERACTION',
          severity: INTERACTION_SEVERITY[r.severity]!,
          message: `${item.drug.genericName} + current medication ${med.genericName}: ${r.description}${
            r.management ? ` ${r.management}` : ''
          }`,
        });
      }
    }
  }
  return out;
}

function checkDuplicateTherapy(patient: PatientSafetyContext, items: ProposedItem[]): SafetyAlert[] {
  const out: SafetyAlert[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const group = atcChemicalSubgroup(item.drug.atcCode);
    for (let j = i + 1; j < items.length; j++) {
      const other = items[j]!;
      if (atcChemicalSubgroup(other.drug.atcCode) !== group) continue;
      out.push({
        key: `DUPLICATE:${item.ref}:${other.ref}`,
        itemRef: item.ref,
        type: 'DUPLICATE_THERAPY',
        severity: 'WARNING',
        message: `${item.drug.genericName} and ${other.drug.genericName} are in the same therapeutic group (${group}).`,
      });
    }
    for (const med of patient.activeMedications) {
      if (atcChemicalSubgroup(med.atcCode) !== group) continue;
      out.push({
        key: `DUPLICATE:${item.ref}:active-${med.drugId}`,
        itemRef: item.ref,
        type: 'DUPLICATE_THERAPY',
        severity: 'WARNING',
        message:
          med.drugId === item.drug.id
            ? `Patient is already taking ${med.genericName}.`
            : `Patient is already taking ${med.genericName}, in the same therapeutic group as ${item.drug.genericName}.`,
      });
    }
  }
  return out;
}

/** Picks the dose-limit rules that apply to this item and patient. Drug-specific rules beat class rules. */
export function applicableDoseLimits(patient: PatientSafetyContext, item: ProposedItem, limits: DoseLimit[]): DoseLimit[] {
  const matches = limits.filter((l) => {
    if (l.drugId && l.drugId !== item.drug.id) return false;
    if (!l.drugId && (!l.atcPrefix || !atcMatches(l.atcPrefix, item.drug.atcCode))) return false;
    if (l.route && l.route.toUpperCase() !== item.route.toUpperCase()) return false;
    if (l.doseUnit.toLowerCase() !== item.doseUnit.toLowerCase()) return false;
    if (l.minAgeMonths != null && (patient.ageMonths == null || patient.ageMonths < l.minAgeMonths)) return false;
    if (l.maxAgeMonths != null && (patient.ageMonths == null || patient.ageMonths > l.maxAgeMonths)) return false;
    if (l.minWeightKg != null && (patient.weightKg == null || patient.weightKg < l.minWeightKg)) return false;
    if (l.maxWeightKg != null && (patient.weightKg == null || patient.weightKg > l.maxWeightKg)) return false;
    if (l.crClBelow != null && (patient.crClMlMin == null || patient.crClMlMin >= l.crClBelow)) return false;
    if (l.hepaticImpairment === true && !patient.hepaticImpairment) return false;
    if (l.perKg && patient.weightKg == null) return false;
    return true;
  });
  const drugSpecific = matches.filter((l) => l.drugId);
  return drugSpecific.length > 0 ? drugSpecific : matches;
}

function checkDoseLimits(patient: PatientSafetyContext, item: ProposedItem, limits: DoseLimit[]): SafetyAlert[] {
  const out: SafetyAlert[] = [];
  const daily = item.dose * item.frequencyPerDay;
  for (const l of applicableDoseLimits(patient, item, limits)) {
    const factor = l.perKg ? patient.weightKg! : 1;
    const unit = item.doseUnit;
    const scope = describeScope(l);
    if (l.maxSingleDose != null && item.dose > l.maxSingleDose * factor) {
      out.push({
        key: `DOSE:${item.ref}:${l.id}:single`,
        itemRef: item.ref,
        type: 'DOSE_LIMIT',
        severity: l.severity,
        message: `Single dose ${item.dose} ${unit} exceeds the maximum ${round(l.maxSingleDose * factor)} ${unit}${scope}.`,
      });
    }
    if (l.maxDailyDose != null && daily > l.maxDailyDose * factor) {
      out.push({
        key: `DOSE:${item.ref}:${l.id}:daily`,
        itemRef: item.ref,
        type: 'DOSE_LIMIT',
        severity: l.severity,
        message: `Daily dose ${round(daily)} ${unit} exceeds the maximum ${round(l.maxDailyDose * factor)} ${unit}/day${scope}.`,
      });
    }
  }
  return out;
}

function describeScope(l: DoseLimit): string {
  const parts: string[] = [];
  if (l.perKg) parts.push('weight-based');
  if (l.crClBelow != null) parts.push(`CrCl < ${l.crClBelow} mL/min`);
  if (l.hepaticImpairment) parts.push('hepatic impairment');
  if (l.maxAgeMonths != null && l.maxAgeMonths < 216) parts.push('paediatric');
  return parts.length ? ` (${parts.join(', ')})` : '';
}

const REPRO_SEVERITY: Record<string, AlertSeverity | null> = {
  CONTRAINDICATED: 'HARD_STOP',
  AVOID: 'WARNING',
  CAUTION: 'INFO',
  SAFE: null,
  UNKNOWN: null,
};

function checkReproductive(patient: PatientSafetyContext, item: ProposedItem): SafetyAlert[] {
  const out: SafetyAlert[] = [];
  if (patient.pregnant) {
    const sev = REPRO_SEVERITY[item.drug.pregnancyRisk];
    if (sev)
      out.push({
        key: `PREGNANCY:${item.ref}`,
        itemRef: item.ref,
        type: 'PREGNANCY',
        severity: sev,
        message: `${item.drug.genericName} in pregnancy: ${item.drug.pregnancyRisk.toLowerCase()}.`,
      });
  }
  if (patient.lactating) {
    const sev = REPRO_SEVERITY[item.drug.lactationRisk];
    if (sev)
      out.push({
        key: `LACTATION:${item.ref}`,
        itemRef: item.ref,
        type: 'LACTATION',
        severity: sev,
        message: `${item.drug.genericName} while breastfeeding: ${item.drug.lactationRisk.toLowerCase()}.`,
      });
  }
  return out;
}

function dedupe(alerts: SafetyAlert[]): SafetyAlert[] {
  const seen = new Map<string, SafetyAlert>();
  for (const a of alerts) if (!seen.has(a.key)) seen.set(a.key, a);
  return [...seen.values()];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface OverrideEvaluation {
  /** True when nothing blocks signing / dispensing. */
  canProceed: boolean;
  /** HARD_STOP alerts. These cannot be overridden. */
  blocking: SafetyAlert[];
  /** WARNING alerts that still need an override reason. */
  unacknowledged: SafetyAlert[];
  /** Alerts with the override applied, for the override log. */
  overridden: (SafetyAlert & { reason: string })[];
}

/**
 * Policy: INFO needs nothing; WARNING needs an override with a reason (min 5
 * characters); HARD_STOP cannot be overridden and blocks the prescription.
 */
export function evaluateOverrides(alerts: SafetyAlert[], overrides: SafetyOverride[]): OverrideEvaluation {
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const blocking: SafetyAlert[] = [];
  const unacknowledged: SafetyAlert[] = [];
  const overridden: (SafetyAlert & { reason: string })[] = [];
  for (const a of alerts) {
    if (a.severity === 'HARD_STOP') blocking.push(a);
    else if (a.severity === 'WARNING') {
      const o = byKey.get(a.key);
      if (o && o.reason.trim().length >= 5) overridden.push({ ...a, reason: o.reason.trim() });
      else unacknowledged.push(a);
    }
  }
  return { canProceed: blocking.length === 0 && unacknowledged.length === 0, blocking, unacknowledged, overridden };
}
