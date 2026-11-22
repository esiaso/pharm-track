import {
  capabilityStatement,
  compact,
  fhirConfigFromEnv,
  parsePatientParam,
  parseToken,
  searchBundle,
  toAdverseEvent,
  toAllergyIntolerance,
  toMedication,
  toMedicationDispense,
  toMedicationRequest,
} from './fhir';

const cfg = fhirConfigFromEnv({});
const drug = {
  id: 'drug-1',
  hptCode: 'HPT-AMOX-500',
  atcCode: 'J01CA04',
  genericName: 'Amoxicillin',
  brandNames: ['Amoxil'],
  strength: '500 mg',
  strengthValue: '500',
  strengthUnit: 'mg',
  dosageForm: 'CAPSULE',
  route: 'ORAL',
  unitOfIssue: 'CAPSULE',
  formularyStatus: 'ACTIVE',
};
const rx = { id: 'rx-1', externalId: 'CT-RX-1', patientId: 'PAT-1', encounterId: 'ENC-1', prescriberId: 'DR-1', facilityId: 'FAC-1', status: 'SIGNED', signedAt: new Date('2026-11-01T08:00:00Z') };
const item = {
  id: 'item-1',
  drugId: 'drug-1',
  drug,
  atcCode: 'J01CA04',
  hptCode: 'HPT-AMOX-500',
  dose: '500',
  doseUnit: 'mg',
  frequency: 'TDS',
  frequencyPerDay: '3',
  route: 'ORAL',
  durationDays: 7,
  quantity: '21',
  refillsAuthorised: 1,
  instructions: null,
  quantityDispensed: '21',
};

describe('FHIR mappings', () => {
  it('maps a drug to Medication with HPT and ATC codings', () => {
    const m = toMedication(cfg, drug) as any;
    expect(m.code.coding).toEqual([
      { system: 'urn:synergyone:codesystem:ppb-hpt', code: 'HPT-AMOX-500', display: 'Amoxicillin 500 mg' },
      { system: 'http://www.whocc.no/atc', code: 'J01CA04' },
    ]);
    expect(m.status).toBe('active');
    expect(m.ingredient[0].strength).toEqual({ numerator: { value: 500, unit: 'mg' }, denominator: { value: 1, unit: 'capsule' } });
    expect(toMedication(cfg, { ...drug, formularyStatus: 'DISCONTINUED' }).status).toBe('inactive');
  });

  it('maps a prescription item to MedicationRequest; status follows quantities and refills', () => {
    const r = toMedicationRequest(cfg, rx, item) as any;
    expect(r).toMatchObject({
      status: 'active', // one refill still to come
      intent: 'order',
      subject: { reference: 'Patient/PAT-1', identifier: { value: 'PAT-1' } },
      groupIdentifier: { value: 'CT-RX-1' },
      requester: { type: 'Practitioner', identifier: { value: 'DR-1' } },
      dispenseRequest: { numberOfRepeatsAllowed: 1, quantity: { value: 21, unit: 'capsule' } },
    });
    expect(r.dosageInstruction[0].timing.repeat).toMatchObject({ frequency: 3, period: 1, periodUnit: 'd' });
    expect(toMedicationRequest(cfg, rx, { ...item, quantityDispensed: '42' }).status).toBe('completed');
    expect(toMedicationRequest(cfg, { ...rx, status: 'CANCELLED' }, item).status).toBe('cancelled');
  });

  it('uses absolute patient references when the CliniTrack FHIR base is set', () => {
    const c = fhirConfigFromEnv({ FHIR_CLINITRACK_BASE: 'https://clinitrack.example/fhir/' });
    expect((toMedicationRequest(c, rx, item) as any).subject.reference).toBe('https://clinitrack.example/fhir/Patient/PAT-1');
  });

  it('maps a dispense line to MedicationDispense with batch, refill type and substitution', () => {
    const line = {
      id: 'line-1',
      prescriptionItemId: 'item-1',
      drugId: 'drug-1',
      drug,
      substitutedFromDrugId: 'drug-0',
      substitutionNote: 'Brand out of stock',
      atcCode: 'J01CA04',
      hptCode: 'HPT-AMOX-500',
      quantity: '21',
      quantityReturned: '3',
      batchNumber: 'B1',
      expiryDate: new Date('2028-01-31T00:00:00Z'),
      dispensedBy: 'u-pharm-1',
      dispensedAt: new Date('2026-11-01T09:00:00Z'),
    };
    const d = toMedicationDispense(cfg, rx, { id: 'o1', kind: 'REFILL', fillSequence: 1, facilityId: 'FAC-1', storeId: 'S1', status: 'DISPENSED' }, line, item) as any;
    expect(d.contained[0].batch).toEqual({ lotNumber: 'B1', expirationDate: '2028-01-31' });
    expect(d.medicationReference.reference).toBe('#med');
    expect(d.type.coding[0].code).toBe('RF');
    expect(d.authorizingPrescription).toEqual([{ reference: 'MedicationRequest/item-1' }]);
    expect(d.substitution).toMatchObject({ wasSubstituted: true, reason: [{ text: 'Brand out of stock' }] });
    expect(d.note).toEqual([{ text: '3 returned to the pharmacy' }]);
    expect(d.status).toBe('completed');
  });

  it('maps allergies, including entered-in-error without a clinical status', () => {
    const base = { id: 'a1', patientId: 'PAT-1', agentType: 'DRUG_CLASS', atcPrefix: 'J01C', agentText: 'Penicillins', reaction: 'Rash', severity: 'LIFE_THREATENING', verificationStatus: 'CONFIRMED', status: 'ACTIVE', source: 'CLINITRACK', recordedBy: 'DR-1', recordedAt: new Date() };
    const a = toAllergyIntolerance(cfg, base) as any;
    expect(a).toMatchObject({ criticality: 'high', category: ['medication'], code: { coding: [{ system: 'http://www.whocc.no/atc', code: 'J01C' }], text: 'Penicillins' } });
    expect(a.clinicalStatus.coding[0].code).toBe('active');
    expect(a.verificationStatus.coding[0].code).toBe('confirmed');
    expect(a.reaction[0]).toEqual({ manifestation: [{ text: 'Rash' }], severity: 'severe' });
    const e = toAllergyIntolerance(cfg, { ...base, status: 'ENTERED_IN_ERROR' }) as any;
    expect(e.clinicalStatus).toBeUndefined();
    expect(e.verificationStatus.coding[0].code).toBe('entered-in-error');
    expect((toAllergyIntolerance(cfg, { ...base, agentType: 'NON_DRUG', atcPrefix: null, agentText: 'Latex' }) as any).category).toBeUndefined();
  });

  it('maps an ADR to AdverseEvent with seriousness, outcome and WHO-UMC causality', () => {
    const r = toAdverseEvent(cfg, {
      id: 'adr-1', patientId: 'PAT-1', drugId: 'drug-1', drug, onsetDate: new Date('2026-11-02T00:00:00Z'), description: 'Urticaria after second dose',
      seriousness: 'SERIOUS_HOSPITALISATION', causality: 'PROBABLE', outcome: 'RECOVERING', reportedBy: 'u-pharm-1', reportedAt: new Date(), ppbReportStatus: 'SUBMITTED', ppbReference: 'PPB-123',
    }) as any;
    expect(r.seriousness.coding[0].code).toBe('serious');
    expect(r.outcome.coding[0].code).toBe('recovering');
    expect(r.suspectEntity[0].causality[0].assessment.coding[0].code).toBe('Probably-Likely');
    expect(r.identifier).toEqual({ system: 'urn:synergyone:ppb:pv-report', value: 'PPB-123' });
  });

  it('builds search bundles and a capability statement', () => {
    const b = searchBundle('https://x/fhir', 'https://x/fhir/Medication?_count=1', [toMedication(cfg, drug)], 2, 'https://x/fhir/Medication?_offset=1') as any;
    expect(b).toMatchObject({ resourceType: 'Bundle', type: 'searchset', total: 2 });
    expect(b.entry[0].fullUrl).toBe('https://x/fhir/Medication/drug-1');
    expect(b.link.map((l: any) => l.relation)).toEqual(['self', 'next']);
    const cs = capabilityStatement('https://x/fhir', '1.0') as any;
    expect(cs.fhirVersion).toBe('4.0.1');
    expect(cs.rest[0].resource.map((r: any) => r.type)).toEqual(['Medication', 'MedicationRequest', 'MedicationDispense', 'AllergyIntolerance', 'AdverseEvent']);
  });

  it('parses references and tokens', () => {
    expect(parsePatientParam('PAT-1')).toBe('PAT-1');
    expect(parsePatientParam('Patient/PAT-1')).toBe('PAT-1');
    expect(parsePatientParam('https://ct/fhir/Patient/PAT%201')).toBe('PAT 1');
    expect(parseToken('http://www.whocc.no/atc|J01CA04')).toEqual({ system: 'http://www.whocc.no/atc', code: 'J01CA04' });
    expect(parseToken('J01CA04')).toEqual({ code: 'J01CA04' });
    expect(compact({ a: undefined, b: [], c: [undefined], d: { e: 1 } })).toEqual({ d: { e: 1 } });
  });
});
