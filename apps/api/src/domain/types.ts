/** Framework-free domain types used by the pure rule engines. */

export type AlertSeverity = 'INFO' | 'WARNING' | 'HARD_STOP';
export type SafetyAlertType =
  | 'ALLERGY'
  | 'INTERACTION'
  | 'CONTRAINDICATION'
  | 'DUPLICATE_THERAPY'
  | 'DOSE_LIMIT'
  | 'PREGNANCY'
  | 'LACTATION'
  | 'FORMULARY'
  | 'EARLY_REFILL';
export type ReproductiveRisk = 'UNKNOWN' | 'SAFE' | 'CAUTION' | 'AVOID' | 'CONTRAINDICATED';
export type FormularyStatus = 'ACTIVE' | 'RESTRICTED' | 'NON_FORMULARY' | 'DISCONTINUED';
export type InteractionSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CONTRAINDICATED';

export interface DrugFacts {
  id: string;
  genericName: string;
  atcCode: string;
  hptCode: string;
  route: string;
  formularyStatus: FormularyStatus;
  pregnancyRisk: ReproductiveRisk;
  lactationRisk: ReproductiveRisk;
}

export interface PatientSafetyContext {
  patientId: string;
  ageMonths?: number;
  weightKg?: number;
  pregnant?: boolean;
  lactating?: boolean;
  /** Creatinine clearance, mL/min. */
  crClMlMin?: number;
  hepaticImpairment?: boolean;
  diagnoses: { system: 'ICD10' | 'ICD11'; code: string }[];
  allergies: {
    id: string;
    agentType: 'DRUG' | 'DRUG_CLASS' | 'NON_DRUG';
    drugId?: string | null;
    atcPrefix?: string | null;
    agentText: string;
    severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING';
    verificationStatus: 'UNCONFIRMED' | 'CONFIRMED' | 'REFUTED';
  }[];
  /** Medicines the patient is currently taking (from medication history). */
  activeMedications: { drugId: string; atcCode: string; genericName: string }[];
}

export interface ProposedItem {
  /** Caller's index or id, echoed back on alerts. */
  ref: string;
  drug: DrugFacts;
  dose: number;
  doseUnit: string;
  frequencyPerDay: number;
  route: string;
}

export interface InteractionRule {
  id: string;
  atcPrefixA: string;
  atcPrefixB: string;
  severity: InteractionSeverity;
  description: string;
  management?: string | null;
}

export interface ContraindicationRule {
  id: string;
  atcPrefix: string;
  diagnosisSystem: 'ICD10' | 'ICD11';
  diagnosisPrefix: string;
  severity: AlertSeverity;
  rationale: string;
}

export interface DoseLimit {
  id: string;
  drugId?: string | null;
  atcPrefix?: string | null;
  route?: string | null;
  minAgeMonths?: number | null;
  maxAgeMonths?: number | null;
  minWeightKg?: number | null;
  maxWeightKg?: number | null;
  crClBelow?: number | null;
  hepaticImpairment?: boolean | null;
  doseUnit: string;
  perKg: boolean;
  maxSingleDose?: number | null;
  maxDailyDose?: number | null;
  severity: AlertSeverity;
  note?: string | null;
}

export interface SafetyRules {
  interactions: InteractionRule[];
  contraindications: ContraindicationRule[];
  doseLimits: DoseLimit[];
}

export interface SafetyAlert {
  /** Stable key; overrides refer to it. */
  key: string;
  itemRef: string;
  type: SafetyAlertType;
  severity: AlertSeverity;
  message: string;
}

export interface SafetyOverride {
  key: string;
  reason: string;
  /** Consultant who authorised overriding a HARD_STOP (only where the facility allows it). */
  authorisedBy?: string;
}

/** A facility's override policy. */
export interface OverridePolicy {
  /** Lets a consultant authorise overriding a hard stop (off by default). */
  hardStopOverride: boolean;
  /** The user recording the override; a consultant cannot be the same person at verification. */
  actorId?: string;
}

/** Shortest reason accepted for overriding a hard stop. */
export const HARD_STOP_REASON_MIN = 15;
