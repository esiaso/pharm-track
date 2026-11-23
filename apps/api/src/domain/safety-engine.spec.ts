import { evaluateOverrides, runSafetyChecks } from './safety-engine';
import type { DrugFacts, PatientSafetyContext, ProposedItem, SafetyRules } from './types';

const drug = (over: Partial<DrugFacts>): DrugFacts => ({
  id: 'd',
  genericName: 'Drug',
  atcCode: 'A01AA01',
  hptCode: 'HPT-1',
  route: 'ORAL',
  formularyStatus: 'ACTIVE',
  pregnancyRisk: 'UNKNOWN',
  lactationRisk: 'UNKNOWN',
  ...over,
});
const amoxicillin = drug({ id: 'amox', genericName: 'Amoxicillin', atcCode: 'J01CA04', hptCode: 'HPT-AMX' });
const warfarin = drug({ id: 'warf', genericName: 'Warfarin', atcCode: 'B01AA03', pregnancyRisk: 'CONTRAINDICATED' });
const ibuprofen = drug({ id: 'ibu', genericName: 'Ibuprofen', atcCode: 'M01AE01' });
const diclofenac = drug({ id: 'dic', genericName: 'Diclofenac', atcCode: 'M01AB05' });
const naproxen = drug({ id: 'nap', genericName: 'Naproxen', atcCode: 'M01AE02' });
const paracetamol = drug({ id: 'para', genericName: 'Paracetamol', atcCode: 'N02BE01' });

const patient = (over: Partial<PatientSafetyContext> = {}): PatientSafetyContext => ({
  patientId: 'p1',
  diagnoses: [],
  allergies: [],
  activeMedications: [],
  ...over,
});
const item = (d: DrugFacts, over: Partial<ProposedItem> = {}): ProposedItem => ({
  ref: d.id,
  drug: d,
  dose: 500,
  doseUnit: 'mg',
  frequencyPerDay: 3,
  route: 'ORAL',
  ...over,
});
const rules: SafetyRules = {
  interactions: [
    { id: 'i1', atcPrefixA: 'B01AA', atcPrefixB: 'M01A', severity: 'MAJOR', description: 'Bleeding risk.', management: 'Avoid or monitor INR.' },
  ],
  contraindications: [
    { id: 'c1', atcPrefix: 'M01A', diagnosisSystem: 'ICD10', diagnosisPrefix: 'K25', severity: 'HARD_STOP', rationale: 'NSAIDs worsen peptic ulcer.' },
  ],
  doseLimits: [
    { id: 'l1', drugId: 'para', doseUnit: 'mg', perKg: false, maxSingleDose: 1000, maxDailyDose: 4000, severity: 'WARNING' },
    { id: 'l2', atcPrefix: 'N02BE01', maxAgeMonths: 143, doseUnit: 'mg', perKg: true, maxSingleDose: 15, maxDailyDose: 60, severity: 'HARD_STOP' },
  ],
};

describe('runSafetyChecks', () => {
  it('returns no alerts for a clean prescription', () => {
    expect(runSafetyChecks(patient(), [item(amoxicillin)], rules)).toEqual([]);
  });

  it('raises a hard stop for a confirmed severe class allergy', () => {
    const p = patient({
      allergies: [{ id: 'a1', agentType: 'DRUG_CLASS', atcPrefix: 'J01C', agentText: 'Penicillins', severity: 'SEVERE', verificationStatus: 'CONFIRMED' }],
    });
    const alerts = runSafetyChecks(p, [item(amoxicillin)], rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'ALLERGY', severity: 'HARD_STOP', key: 'ALLERGY:amox:a1' });
  });

  it('downgrades an unconfirmed allergy to a warning and ignores refuted ones', () => {
    const p = patient({
      allergies: [
        { id: 'a1', agentType: 'DRUG', drugId: 'amox', agentText: 'Amoxicillin', severity: 'SEVERE', verificationStatus: 'UNCONFIRMED' },
        { id: 'a2', agentType: 'DRUG', drugId: 'amox', agentText: 'Amoxicillin', severity: 'SEVERE', verificationStatus: 'REFUTED' },
      ],
    });
    const alerts = runSafetyChecks(p, [item(amoxicillin)], rules);
    expect(alerts.map((a) => [a.key, a.severity])).toEqual([['ALLERGY:amox:a1', 'WARNING']]);
  });

  it('finds interactions between new items and with current medications', () => {
    const between = runSafetyChecks(patient(), [item(warfarin, { dose: 5 }), item(ibuprofen, { dose: 400 })], rules);
    expect(between.some((a) => a.type === 'INTERACTION' && a.severity === 'WARNING')).toBe(true);

    const withActive = runSafetyChecks(
      patient({ activeMedications: [{ drugId: 'warf', atcCode: 'B01AA03', genericName: 'Warfarin' }] }),
      [item(ibuprofen, { dose: 400 })],
      rules,
    );
    expect(withActive.find((a) => a.type === 'INTERACTION')?.message).toContain('current medication Warfarin');
  });

  it('flags drug-disease contraindications by ICD prefix', () => {
    const alerts = runSafetyChecks(patient({ diagnoses: [{ system: 'ICD10', code: 'K25.9' }] }), [item(diclofenac, { dose: 50 })], rules);
    expect(alerts.find((a) => a.type === 'CONTRAINDICATION')?.severity).toBe('HARD_STOP');
  });

  it('flags duplicate therapy in the same chemical subgroup', () => {
    const alerts = runSafetyChecks(patient(), [item(ibuprofen, { dose: 400 }), item(naproxen, { dose: 250 })], rules);
    expect(alerts.filter((a) => a.type === 'DUPLICATE_THERAPY')).toHaveLength(1);
  });

  it('checks adult dose limits (drug-specific rule wins)', () => {
    const alerts = runSafetyChecks(patient({ ageMonths: 400 }), [item(paracetamol, { dose: 1500, frequencyPerDay: 4 })], rules);
    expect(alerts.map((a) => a.key).sort()).toEqual(['DOSE:para:l1:daily', 'DOSE:para:l1:single']);
  });

  it('checks paediatric weight-based limits', () => {
    const child = patient({ ageMonths: 60, weightKg: 18 });
    // Only the class-level paediatric rule applies when no drug-specific rule matches.
    const limits = { ...rules, doseLimits: rules.doseLimits.filter((l) => l.id === 'l2') };
    const ok = runSafetyChecks(child, [item(paracetamol, { dose: 250, frequencyPerDay: 4 })], limits);
    expect(ok).toEqual([]);
    const over = runSafetyChecks(child, [item(paracetamol, { dose: 500, frequencyPerDay: 4 })], limits);
    expect(over.map((a) => a.severity)).toEqual(['HARD_STOP', 'HARD_STOP']);
    expect(over[0]!.message).toContain('270 mg');
  });

  it('flags pregnancy risk and formulary status', () => {
    const alerts = runSafetyChecks(
      patient({ pregnant: true }),
      [item(warfarin, { dose: 5 }), item(drug({ id: 'old', genericName: 'Old', atcCode: 'C01AA05', formularyStatus: 'DISCONTINUED' }))],
      rules,
    );
    expect(alerts.find((a) => a.type === 'PREGNANCY')?.severity).toBe('HARD_STOP');
    expect(alerts.find((a) => a.type === 'FORMULARY')?.severity).toBe('HARD_STOP');
  });
});

describe('evaluateOverrides', () => {
  const alerts = [
    { key: 'w1', itemRef: 'x', type: 'INTERACTION' as const, severity: 'WARNING' as const, message: '' },
    { key: 'i1', itemRef: 'x', type: 'DUPLICATE_THERAPY' as const, severity: 'INFO' as const, message: '' },
  ];

  it('requires a reason for warnings', () => {
    expect(evaluateOverrides(alerts, []).canProceed).toBe(false);
    expect(evaluateOverrides(alerts, [{ key: 'w1', reason: 'ok' }]).canProceed).toBe(false);
    const r = evaluateOverrides(alerts, [{ key: 'w1', reason: 'Benefit outweighs risk, INR monitored' }]);
    expect(r.canProceed).toBe(true);
    expect(r.overridden).toHaveLength(1);
  });

  it('never lets a hard stop through unless the facility allows consultant overrides', () => {
    const hard = [{ ...alerts[0]!, severity: 'HARD_STOP' as const }];
    const r = evaluateOverrides(hard, [{ key: 'w1', reason: 'Consultant approved this course', authorisedBy: 'dr.consultant' }]);
    expect(r.canProceed).toBe(false);
    expect(r.blocking).toHaveLength(1);
    expect(r.overridable).toEqual([]);
  });

  it('lets a named consultant override a hard stop with a full reason, where allowed', () => {
    const hard = [{ ...alerts[0]!, severity: 'HARD_STOP' as const }];
    const policy = { hardStopOverride: true, actorId: 'pharm-1' };
    const blocked = evaluateOverrides(hard, [], policy);
    expect(blocked.overridable).toEqual(['w1']);
    // No consultant, a short reason, or the pharmacist naming themselves: still blocked.
    expect(evaluateOverrides(hard, [{ key: 'w1', reason: 'Benefit outweighs the risk here' }], policy).canProceed).toBe(false);
    expect(evaluateOverrides(hard, [{ key: 'w1', reason: 'Approved', authorisedBy: 'dr.k' }], policy).canProceed).toBe(false);
    expect(evaluateOverrides(hard, [{ key: 'w1', reason: 'Benefit outweighs the risk here', authorisedBy: 'PHARM-1' }], policy).canProceed).toBe(false);
    const ok = evaluateOverrides(hard, [{ key: 'w1', reason: 'Benefit outweighs the risk here', authorisedBy: 'dr.kamau' }], policy);
    expect(ok.canProceed).toBe(true);
    expect(ok.overridden[0]).toMatchObject({ authorisedBy: 'dr.kamau', reason: 'Benefit outweighs the risk here' });
  });

  it('never lets a discontinued drug through', () => {
    const hard = [{ key: 'f1', itemRef: 'x', type: 'FORMULARY' as const, severity: 'HARD_STOP' as const, message: 'Discontinued' }];
    const r = evaluateOverrides(hard, [{ key: 'f1', reason: 'Benefit outweighs the risk here', authorisedBy: 'dr.kamau' }], { hardStopOverride: true });
    expect(r.canProceed).toBe(false);
    expect(r.overridable).toEqual([]);
  });
});
