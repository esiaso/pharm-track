/**
 * FHIR R4 views of PharmTrack records. Pure functions: the FHIR module loads
 * rows and these map them. PharmTrack stays the source of truth; FHIR is a
 * read-only facade for CliniTrack, a health information exchange, or other
 * SynergyOne modules.
 *
 * Code systems:
 * - WHO ATC uses the system URI published in FHIR (http://www.whocc.no/atc).
 * - PPB HPT codes have no published FHIR system URI yet, so the URI is a
 *   setting (FHIR_HPT_SYSTEM). Replace the default once Kenya's registry
 *   (Digital Health Agency / PPB) publishes one.
 */

export type FhirResource = { resourceType: string; id?: string; [k: string]: unknown };

export interface FhirConfig {
  hptSystem: string;
  patientSystem: string;
  practitionerSystem: string;
  encounterSystem: string;
  prescriptionSystem: string;
  /** Base URL of the FHIR server that owns Patient/Encounter (CliniTrack). Empty = relative references. */
  patientBase: string;
}

export const ATC_SYSTEM = 'http://www.whocc.no/atc';
const UCUM = 'http://unitsofmeasure.org';
const T = 'http://terminology.hl7.org/CodeSystem';

export function fhirConfigFromEnv(env: Record<string, string | undefined> = process.env): FhirConfig {
  return {
    hptSystem: env.FHIR_HPT_SYSTEM || 'urn:synergyone:codesystem:ppb-hpt',
    patientSystem: env.FHIR_PATIENT_SYSTEM || 'urn:synergyone:clinitrack:patient',
    practitionerSystem: env.FHIR_PRACTITIONER_SYSTEM || 'urn:synergyone:sso:user',
    encounterSystem: env.FHIR_ENCOUNTER_SYSTEM || 'urn:synergyone:clinitrack:encounter',
    prescriptionSystem: env.FHIR_PRESCRIPTION_SYSTEM || 'urn:synergyone:clinitrack:prescription',
    patientBase: (env.FHIR_CLINITRACK_BASE || '').replace(/\/+$/, ''),
  };
}

// ─── Inputs (the subset of each Prisma row the mappers read) ───────────────

type Num = number | string | { toString(): string } | null | undefined;

export interface DrugRow {
  id: string;
  hptCode: string;
  atcCode: string;
  genericName: string;
  brandNames: string[];
  strength: string;
  strengthValue?: Num;
  strengthUnit?: string | null;
  dosageForm: string;
  route: string;
  unitOfIssue: string;
  formularyStatus: string;
  updatedAt?: Date;
}

export interface PrescriptionRow {
  id: string;
  externalId: string;
  patientId: string;
  encounterId: string;
  prescriberId: string;
  facilityId: string;
  status: string;
  signedAt: Date;
}

export interface ItemRow {
  id: string;
  drugId: string;
  drug?: DrugRow | null;
  atcCode: string;
  hptCode: string;
  dose: Num;
  doseUnit: string;
  frequency: string;
  frequencyPerDay: Num;
  route: string;
  durationDays: number;
  quantity: Num;
  refillsAuthorised: number;
  instructions?: string | null;
  quantityDispensed: Num;
}

export interface DispenseLineRow {
  id: string;
  prescriptionItemId: string;
  drugId: string;
  drug?: DrugRow | null;
  substitutedFromDrugId?: string | null;
  substitutionNote?: string | null;
  atcCode: string;
  hptCode: string;
  quantity: Num;
  quantityReturned: Num;
  batchNumber: string;
  expiryDate: Date;
  labelText?: string | null;
  dispensedBy: string;
  dispensedAt: Date;
}

export interface DispenseOrderRow {
  id: string;
  kind: string;
  fillSequence: number;
  facilityId: string;
  storeId: string;
  status: string;
  verifiedBy?: string | null;
}

export interface AllergyRow {
  id: string;
  patientId: string;
  agentType: string;
  drugId?: string | null;
  drug?: DrugRow | null;
  atcPrefix?: string | null;
  agentText: string;
  reaction?: string | null;
  severity: string;
  verificationStatus: string;
  status: string;
  source: string;
  recordedBy: string;
  recordedAt: Date;
  updatedAt?: Date;
}

export interface AdrRow {
  id: string;
  patientId: string;
  encounterId?: string | null;
  drugId: string;
  drug?: DrugRow | null;
  dispenseLineId?: string | null;
  onsetDate: Date;
  description: string;
  seriousness: string;
  causality: string;
  actionTaken?: string | null;
  outcome: string;
  reportedBy: string;
  reportedAt: Date;
  ppbReportStatus: string;
  ppbReference?: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const num = (v: Num): number | undefined => (v === null || v === undefined || v === '' ? undefined : Number(v.toString()));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const date = (d: Date) => d.toISOString().slice(0, 10);

/** Removes undefined values and empty arrays so resources stay small and valid. */
export function compact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(compact).filter((x) => x !== undefined) as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = compact(x);
      if (c === undefined || (Array.isArray(c) && c.length === 0)) continue;
      out[k] = c;
    }
    return out as T;
  }
  return v;
}

export function patientRef(cfg: FhirConfig, patientId: string) {
  return {
    reference: cfg.patientBase ? `${cfg.patientBase}/Patient/${patientId}` : `Patient/${patientId}`,
    identifier: { system: cfg.patientSystem, value: patientId },
  };
}

/** Logical reference for things PharmTrack does not hold (practitioners, encounters). */
const identifierRef = (type: string, system: string, value: string) => ({ type, identifier: { system, value } });

export function medicationCode(cfg: FhirConfig, d: { hptCode: string; atcCode: string; genericName?: string; strength?: string }) {
  const display = d.genericName ? `${d.genericName}${d.strength ? ` ${d.strength}` : ''}` : undefined;
  return {
    coding: [
      { system: cfg.hptSystem, code: d.hptCode, display },
      { system: ATC_SYSTEM, code: d.atcCode },
    ],
    text: display,
  };
}

// ─── Medication ────────────────────────────────────────────────────────────

export function toMedication(cfg: FhirConfig, d: DrugRow): FhirResource {
  const strength = num(d.strengthValue);
  return compact({
    resourceType: 'Medication',
    id: d.id,
    meta: { lastUpdated: iso(d.updatedAt) },
    identifier: [{ system: cfg.hptSystem, value: d.hptCode }],
    code: medicationCode(cfg, d),
    status: d.formularyStatus === 'DISCONTINUED' ? 'inactive' : 'active',
    form: { text: d.dosageForm.toLowerCase() },
    ingredient: [
      {
        itemCodeableConcept: { text: d.genericName },
        isActive: true,
        strength:
          strength !== undefined && d.strengthUnit
            ? { numerator: { value: strength, unit: d.strengthUnit }, denominator: { value: 1, unit: d.unitOfIssue.toLowerCase() } }
            : undefined,
      },
    ],
    extension: d.brandNames.length
      ? d.brandNames.map((b) => ({ url: 'urn:synergyone:fhir:StructureDefinition/brand-name', valueString: b }))
      : undefined,
  });
}

// ─── MedicationRequest ─────────────────────────────────────────────────────

export function medicationRequestStatus(rx: PrescriptionRow, item: ItemRow): string {
  if (rx.status === 'CANCELLED') return 'cancelled';
  if (rx.status === 'COMPLETED') return 'completed';
  const total = (num(item.quantity) ?? 0) * (1 + item.refillsAuthorised);
  if (total > 0 && (num(item.quantityDispensed) ?? 0) >= total) return 'completed';
  return 'active';
}

export function dosage(item: ItemRow) {
  const perDay = num(item.frequencyPerDay);
  return compact({
    text: item.instructions ?? `${num(item.dose)} ${item.doseUnit} ${item.frequency} for ${item.durationDays} days`,
    timing: {
      code: { text: item.frequency },
      repeat:
        perDay !== undefined && perDay > 0
          ? Number.isInteger(perDay)
            ? { frequency: perDay, period: 1, periodUnit: 'd', boundsDuration: { value: item.durationDays, unit: 'days', system: UCUM, code: 'd' } }
            : { frequency: 1, period: Math.round((24 / perDay) * 100) / 100, periodUnit: 'h', boundsDuration: { value: item.durationDays, unit: 'days', system: UCUM, code: 'd' } }
          : undefined,
    },
    route: { text: item.route.toLowerCase() },
    doseAndRate: [{ doseQuantity: { value: num(item.dose), unit: item.doseUnit } }],
  });
}

export function toMedicationRequest(cfg: FhirConfig, rx: PrescriptionRow, item: ItemRow): FhirResource {
  return compact({
    resourceType: 'MedicationRequest',
    id: item.id,
    identifier: [{ system: 'urn:synergyone:pharmtrack:prescription-item', value: item.id }],
    groupIdentifier: { system: cfg.prescriptionSystem, value: rx.externalId },
    status: medicationRequestStatus(rx, item),
    intent: 'order',
    medicationReference: { reference: `Medication/${item.drugId}`, display: item.drug ? `${item.drug.genericName} ${item.drug.strength}` : undefined },
    subject: patientRef(cfg, rx.patientId),
    encounter: identifierRef('Encounter', cfg.encounterSystem, rx.encounterId),
    authoredOn: iso(rx.signedAt),
    requester: identifierRef('Practitioner', cfg.practitionerSystem, rx.prescriberId),
    dosageInstruction: [dosage(item)],
    dispenseRequest: {
      numberOfRepeatsAllowed: item.refillsAuthorised,
      quantity: { value: num(item.quantity), unit: item.drug?.unitOfIssue.toLowerCase() },
      expectedSupplyDuration: { value: item.durationDays, unit: 'days', system: UCUM, code: 'd' },
    },
  });
}

// ─── MedicationDispense ────────────────────────────────────────────────────

export function toMedicationDispense(cfg: FhirConfig, rx: PrescriptionRow, order: DispenseOrderRow, line: DispenseLineRow, item?: ItemRow | null): FhirResource {
  const qty = num(line.quantity) ?? 0;
  const returned = num(line.quantityReturned) ?? 0;
  const drug = line.drug;
  return compact({
    resourceType: 'MedicationDispense',
    id: line.id,
    // The batch belongs to the product supplied, so it sits on a contained Medication.
    contained: [
      {
        resourceType: 'Medication',
        id: 'med',
        code: medicationCode(cfg, { hptCode: line.hptCode, atcCode: line.atcCode, genericName: drug?.genericName, strength: drug?.strength }),
        batch: { lotNumber: line.batchNumber, expirationDate: date(line.expiryDate) },
      },
    ],
    identifier: [{ system: 'urn:synergyone:pharmtrack:dispense-line', value: line.id }],
    status: order.status === 'CANCELLED' ? 'cancelled' : 'completed',
    category: { coding: [{ system: `${T}/medicationdispense-category`, code: 'outpatient' }] },
    medicationReference: { reference: '#med', display: drug ? `${drug.genericName} ${drug.strength}` : undefined },
    subject: patientRef(cfg, rx.patientId),
    performer: [{ actor: identifierRef('Practitioner', cfg.practitionerSystem, line.dispensedBy) }],
    authorizingPrescription: [{ reference: `MedicationRequest/${line.prescriptionItemId}` }],
    type: {
      coding: [
        order.kind === 'REFILL'
          ? { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'RF', display: 'Refill' }
          : { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'FF', display: 'First Fill' },
      ],
    },
    quantity: { value: qty, unit: drug?.unitOfIssue.toLowerCase() },
    daysSupply: item ? { value: item.durationDays, unit: 'days', system: UCUM, code: 'd' } : undefined,
    whenHandedOver: iso(line.dispensedAt),
    note: [
      returned > 0 ? { text: `${returned} returned to the pharmacy` } : undefined,
      line.labelText ? { text: `Label: ${line.labelText}` } : undefined,
    ],
    dosageInstruction: item ? [dosage(item)] : undefined,
    substitution: {
      wasSubstituted: !!line.substitutedFromDrugId,
      type: line.substitutedFromDrugId ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-substanceAdminSubstitution', code: 'G', display: 'generic composition' }] } : undefined,
      reason: line.substitutionNote ? [{ text: line.substitutionNote }] : undefined,
    },
  });
}

// ─── AllergyIntolerance ────────────────────────────────────────────────────

const ALLERGY_CLINICAL: Record<string, string> = { ACTIVE: 'active', INACTIVE: 'inactive' };
const ALLERGY_VERIFICATION: Record<string, string> = { UNCONFIRMED: 'unconfirmed', CONFIRMED: 'confirmed', REFUTED: 'refuted' };
const REACTION_SEVERITY: Record<string, string> = { MILD: 'mild', MODERATE: 'moderate', SEVERE: 'severe', LIFE_THREATENING: 'severe' };

export function toAllergyIntolerance(cfg: FhirConfig, a: AllergyRow): FhirResource {
  const enteredInError = a.status === 'ENTERED_IN_ERROR';
  const codings =
    a.agentType === 'DRUG' && a.drug
      ? medicationCode(cfg, a.drug).coding
      : a.agentType === 'DRUG_CLASS' && a.atcPrefix
        ? [{ system: ATC_SYSTEM, code: a.atcPrefix }]
        : [];
  if (a.agentType === 'DRUG' && a.atcPrefix) codings.push({ system: ATC_SYSTEM, code: a.atcPrefix, display: undefined });
  return compact({
    resourceType: 'AllergyIntolerance',
    id: a.id,
    meta: { lastUpdated: iso(a.updatedAt) },
    // entered-in-error records carry no clinical status (FHIR invariant ait-2).
    clinicalStatus: enteredInError ? undefined : { coding: [{ system: `${T}/allergyintolerance-clinical`, code: ALLERGY_CLINICAL[a.status] ?? 'active' }] },
    verificationStatus: {
      coding: [{ system: `${T}/allergyintolerance-verification`, code: enteredInError ? 'entered-in-error' : (ALLERGY_VERIFICATION[a.verificationStatus] ?? 'unconfirmed') }],
    },
    type: 'allergy',
    category: [a.agentType === 'NON_DRUG' ? undefined : 'medication'],
    criticality: a.severity === 'LIFE_THREATENING' || a.severity === 'SEVERE' ? 'high' : 'low',
    code: { coding: codings, text: a.agentText },
    patient: patientRef(cfg, a.patientId),
    recordedDate: iso(a.recordedAt),
    recorder: identifierRef('Practitioner', cfg.practitionerSystem, a.recordedBy),
    reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }], severity: REACTION_SEVERITY[a.severity] }] : undefined,
    extension: [{ url: 'urn:synergyone:fhir:StructureDefinition/source-system', valueCode: a.source.toLowerCase() }],
  });
}

// ─── AdverseEvent ──────────────────────────────────────────────────────────

const ADR_OUTCOME: Record<string, string> = {
  RECOVERED: 'resolved',
  RECOVERING: 'recovering',
  NOT_RECOVERED: 'ongoing',
  RECOVERED_WITH_SEQUELAE: 'resolvedWithSequelae',
  FATAL: 'fatal',
  UNKNOWN: 'unknown',
};
/** WHO-UMC categories as coded in FHIR's adverse-event-causality-assess code system. */
const ADR_CAUSALITY: Record<string, string> = {
  CERTAIN: 'Certain',
  PROBABLE: 'Probably-Likely',
  POSSIBLE: 'Possible',
  UNLIKELY: 'Unlikely',
  CONDITIONAL: 'Conditional-Classified',
  UNASSESSABLE: 'Unassessable-Unclassifiable',
};

export function toAdverseEvent(cfg: FhirConfig, r: AdrRow): FhirResource {
  const serious = r.seriousness !== 'NON_SERIOUS';
  const causality = ADR_CAUSALITY[r.causality];
  return compact({
    resourceType: 'AdverseEvent',
    id: r.id,
    identifier: r.ppbReference ? { system: 'urn:synergyone:ppb:pv-report', value: r.ppbReference } : undefined,
    actuality: 'actual',
    event: { text: r.description },
    subject: patientRef(cfg, r.patientId),
    encounter: r.encounterId ? identifierRef('Encounter', cfg.encounterSystem, r.encounterId) : undefined,
    date: iso(r.onsetDate),
    recordedDate: iso(r.reportedAt),
    recorder: identifierRef('Practitioner', cfg.practitionerSystem, r.reportedBy),
    seriousness: {
      coding: [{ system: `${T}/adverse-event-seriousness`, code: serious ? 'serious' : 'non-serious' }],
      text: r.seriousness.toLowerCase().replace(/_/g, ' '),
    },
    outcome: { coding: [{ system: `${T}/adverse-event-outcome`, code: ADR_OUTCOME[r.outcome] ?? 'unknown' }] },
    suspectEntity: [
      {
        instance: { reference: `Medication/${r.drugId}`, display: r.drug ? `${r.drug.genericName} ${r.drug.strength}` : undefined },
        causality: causality
          ? [{ assessment: { coding: [{ system: `${T}/adverse-event-causality-assess`, code: causality }] }, method: { text: 'WHO-UMC' } }]
          : undefined,
      },
    ],
    extension: [
      r.actionTaken ? { url: 'urn:synergyone:fhir:StructureDefinition/action-taken', valueString: r.actionTaken } : undefined,
      { url: 'urn:synergyone:fhir:StructureDefinition/ppb-report-status', valueCode: r.ppbReportStatus.toLowerCase() },
    ],
  });
}

// ─── Bundles and errors ────────────────────────────────────────────────────

export function searchBundle(base: string, selfUrl: string, resources: FhirResource[], total: number, next?: string): FhirResource {
  return compact({
    resourceType: 'Bundle',
    type: 'searchset',
    total,
    link: [{ relation: 'self', url: selfUrl }, next ? { relation: 'next', url: next } : undefined],
    entry: resources.map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r, search: { mode: 'match' } })),
  });
}

export function operationOutcome(code: string, diagnostics: string, severity: 'error' | 'fatal' | 'warning' = 'error'): FhirResource {
  return { resourceType: 'OperationOutcome', issue: [{ severity, code, diagnostics }] };
}

/** Accepts "123", "Patient/123" or an absolute ".../Patient/123" and returns "123". */
export function parsePatientParam(v: string): string {
  const m = /(?:^|\/)Patient\/([^/?#]+)$/.exec(v.trim());
  return m ? decodeURIComponent(m[1]) : v.trim();
}

/** Splits a token search value "system|code" (either side optional). */
export function parseToken(v: string): { system?: string; code: string } {
  const i = v.indexOf('|');
  return i < 0 ? { code: v } : { system: v.slice(0, i) || undefined, code: v.slice(i + 1) };
}

export const FHIR_RESOURCES = ['Medication', 'MedicationRequest', 'MedicationDispense', 'AllergyIntolerance', 'AdverseEvent'] as const;
export type FhirResourceType = (typeof FHIR_RESOURCES)[number];

export const SEARCH_PARAMS: Record<FhirResourceType, { name: string; type: string; documentation: string }[]> = {
  Medication: [
    { name: '_id', type: 'token', documentation: 'Logical id' },
    { name: 'code', type: 'token', documentation: 'PPB HPT or WHO ATC code, optionally system|code' },
    { name: 'status', type: 'token', documentation: 'active | inactive' },
  ],
  MedicationRequest: [
    { name: 'patient', type: 'reference', documentation: 'Required unless _id is given' },
    { name: '_id', type: 'token', documentation: 'Logical id' },
    { name: 'status', type: 'token', documentation: 'active | completed | cancelled' },
    { name: 'encounter', type: 'token', documentation: 'CliniTrack encounter id' },
  ],
  MedicationDispense: [
    { name: 'patient', type: 'reference', documentation: 'Required unless _id or prescription is given' },
    { name: '_id', type: 'token', documentation: 'Logical id' },
    { name: 'prescription', type: 'reference', documentation: 'MedicationRequest id' },
  ],
  AllergyIntolerance: [
    { name: 'patient', type: 'reference', documentation: 'Required unless _id is given' },
    { name: '_id', type: 'token', documentation: 'Logical id' },
    { name: 'clinical-status', type: 'token', documentation: 'active | inactive' },
  ],
  AdverseEvent: [
    { name: 'subject', type: 'reference', documentation: 'Patient; required unless _id is given' },
    { name: '_id', type: 'token', documentation: 'Logical id' },
  ],
};

export function capabilityStatement(base: string, version: string): FhirResource {
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString().slice(0, 10),
    publisher: 'SynergyOne',
    kind: 'instance',
    software: { name: 'PharmTrack', version },
    implementation: { description: 'PharmTrack FHIR R4 read-only facade', url: base },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json', 'json'],
    rest: [
      {
        mode: 'server',
        security: {
          service: [{ coding: [{ system: `${T}/restful-security-service`, code: 'OAuth' }] }],
          description: 'Bearer token from SynergyOne SSO. Every read of patient data is recorded in the access log.',
        },
        resource: FHIR_RESOURCES.map((type) => ({
          type,
          interaction: [{ code: 'read' }, { code: 'search-type' }],
          searchParam: [...SEARCH_PARAMS[type], { name: '_count', type: 'number', documentation: 'Page size, at most 200' }].map(({ name, type: t, documentation }) => ({
            name,
            type: t,
            documentation,
          })),
        })),
      },
    ],
  };
}
