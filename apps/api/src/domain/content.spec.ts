import {
  parseAtcCsv,
  parseContraindicationsCsv,
  parseDoseLimitsCsv,
  parseDrugsCsv,
  parseFacilityFormularyCsv,
  parseHptCsv,
  parseInteractionsCsv,
  primaryDdd,
  TEMPLATES,
  CONTENT_KINDS,
  diffRules,
} from './content';
import { toCsv } from './csv';

describe('WHO ATC/DDD import', () => {
  const whoExport = [
    'ATC code,ATC level name,DDD,U,Adm.R,Note',
    'A,ALIMENTARY TRACT AND METABOLISM,,,,',
    'A10,DRUGS USED IN DIABETES,,,,',
    'A10BA02,metformin,2,g,O,',
    'N02BE01,paracetamol,3,g,O,',
    'N02BE01,,3,g,P,',
    'N02BE01,paracetamol,3,g,R,',
    'j01ca04,amoxicillin,"1,5",g,O,',
    'X99,not a code,,,,',
    'A10BA,biguanides,5,g,O,',
  ].join('\n');

  it('merges repeated codes into one row with several DDDs', () => {
    const { rows, errors } = parseAtcCsv(whoExport);
    const para = rows.find((r) => r.code === 'N02BE01')!;
    expect(para.name).toBe('paracetamol');
    expect(para.ddds.map((d) => d.route)).toEqual(['O', 'P', 'R']);
    expect(primaryDdd(para.ddds)!.route).toBe('O');
    expect(rows.find((r) => r.code === 'J01CA04')!.ddds[0]!.ddd).toBe(1.5);
    expect(errors).toEqual([
      { line: 9, message: '"X99" is not a valid ATC code' },
      { line: 10, message: 'DDDs are only given for level-5 codes' },
    ]);
  });

  it('reports missing required columns once', () => {
    expect(parseAtcCsv('code,ddd\nA,1').errors).toEqual([{ line: 1, message: 'Missing column(s): atc_level_name' }]);
  });

  it('rejects a DDD without a unit and a code listed with two names', () => {
    const { errors } = parseAtcCsv('atc_code,name,ddd,u\nA10BA02,metformin,2,\nB01AA03,warfarin,,\nB01AA03,acenocoumarol,,');
    expect(errors.map((e) => e.message)).toEqual(['DDD unit (U) is required when a DDD is given', 'B01AA03 appears with two names ("warfarin", "acenocoumarol")']);
  });
});

describe('PPB HPT import', () => {
  it('normalises codes and rejects duplicates and blanks', () => {
    const { rows, errors } = parseHptCsv('HPT Code,Description,Status\nabc-001,Metformin 500 mg,Registered\nABC-001,Dup,\nABC-002,,\n,Nothing,');
    expect(rows).toEqual([{ line: 2, code: 'ABC-001', description: 'Metformin 500 mg', category: undefined, ppbStatus: 'REGISTERED' }]);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });

  it('reads the FHIR CodeSystem from the DHA terminology server, skipping section headings', () => {
    const json = JSON.stringify({
      resourceType: 'CodeSystem',
      id: 'HPT',
      concept: [
        { code: 'Catalog', display: 'Catalog', active: true },
        { code: '-1', display: 'Vasopril 5 mg Oral Tablet', active: true },
        { code: 'AC10001', display: 'Metformin', active: true },
        { code: 'GE10002', display: 'Metformin 500 mg Oral Tablet', active: true },
        { code: 'PH100-1', display: 'Medistatin 100000 mcg Oral Suspension', active: false },
        { code: 'GE10002', display: 'Again', active: true },
        { code: 'FS10010', display: ' ', active: true },
        { code: 'RT10001', display: 'Buccal', active: true },
        { code: 'PH1724+C23908', display: 'Broken', active: true },
      ],
    });
    const { rows, errors, skipped } = parseHptCsv(`  ${json}`);
    expect(rows).toEqual([
      { line: 4, code: 'GE10002', description: 'Metformin 500 mg Oral Tablet', category: 'Generic product', ppbStatus: 'ACTIVE' },
      { line: 5, code: 'PH100-1', description: 'Medistatin 100000 mcg Oral Suspension', category: 'Branded product', ppbStatus: 'INACTIVE' },
    ]);
    expect(errors).toEqual([{ line: 6, message: 'GE10002 appears more than once' }, { line: 7, message: 'FS10010 has no description' }]);
    expect(skipped).toEqual([
      { line: 1, message: '"Catalog" is not an HPT product code' },
      { line: 2, message: '"-1" is not an HPT product code' },
      { line: 9, message: '"PH1724+C23908" is not an HPT product code' },
      { line: 3, message: 'AC10001 is an active ingredient, not a product' },
      { line: 8, message: 'RT10001 is a route, not a product' },
    ]);
    expect(parseHptCsv('{"resourceType":"ValueSet"}').errors[0]!.message).toMatch(/FHIR CodeSystem/);
    expect(parseHptCsv('{ not json').errors[0]!.message).toMatch(/not valid JSON/);
  });
});

describe('safety rule files', () => {
  it('validates interactions and catches reversed duplicates', () => {
    const { rows, errors } = parseInteractionsCsv(
      'atc_a,atc_b,severity,description,management\nB01AA,M01A,major,Bleeding,Monitor INR\nM01A,B01AA,MAJOR,dup,\nB01AA,Q99,MINOR,x,\nB01AA,B01AA,MINOR,x,\nC09AA,C03DA,severe,x,',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ atcPrefixA: 'B01AA', atcPrefixB: 'M01A', severity: 'MAJOR', management: 'Monitor INR' });
    expect(errors.map((e) => e.message)).toEqual([
      'The pair M01A / B01AA appears more than once',
      'ATC B "Q99" is not a valid ATC code or class',
      'ATC A and ATC B are the same',
      'Severity "severe" must be one of MINOR, MODERATE, MAJOR, CONTRAINDICATED',
    ]);
  });

  it('validates contraindications with ICD-10 by default and ICD-11 when asked', () => {
    const { rows, errors } = parseContraindicationsCsv(
      'atc,diagnosis_system,diagnosis_code,severity,rationale\nM01A,,k25,HARD_STOP,Ulcer\nM01A,ICD11,DA60,WARNING,Ulcer\nM01A,ICD10,25K,WARNING,x\nM01A,ICD10,K25,BLOCK,x',
    );
    expect(rows.map((r) => [r.diagnosisSystem, r.diagnosisPrefix])).toEqual([['ICD10', 'K25'], ['ICD11', 'DA60']]);
    expect(errors.map((e) => e.line)).toEqual([4, 5]);
  });

  it('validates dose limits', () => {
    const { rows, errors } = parseDoseLimitsCsv(
      [
        'hpt_code,atc,route,min_age_months,dose_unit,per_kg,max_single_dose,max_daily_dose,severity,hepatic_impairment',
        ',N02BE01,oral,216,mg,no,1000,4000,,',
        ',N02BE01,,,mg/kg,yes,15,60,HARD_STOP,yes',
        'X-1,N02BE01,,,mg,,1,2,,',
        ',N02BE01,,,mg,,,,,',
        ',N02BE01,,,mg,,500,100,,',
        ',N02BE01,,1.5,mg,,1,2,,maybe',
      ].join('\n'),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ atcPrefix: 'N02BE01', route: 'ORAL', minAgeMonths: 216, perKg: false, severity: 'WARNING' });
    expect(rows[1]).toMatchObject({ perKg: true, hepaticImpairment: true, severity: 'HARD_STOP' });
    expect(errors.map((e) => e.message)).toEqual([
      'Give an HPT code or an ATC code, not both',
      'Give a max single dose, a max daily dose, or both',
      'Max single dose is more than the max daily dose',
      'Min age (months) must be a whole number',
      'Hepatic impairment "maybe" must be yes or no',
    ]);
  });
});

describe('formulary files', () => {
  it('requires an approver for restricted items', () => {
    const { rows, errors } = parseFacilityFormularyCsv('hpt_code,status,approval_required_by\nA-001,active,\nA-002,RESTRICTED,\nA-003,non formulary,');
    expect(rows.map((r) => r.status)).toEqual(['ACTIVE', 'NON_FORMULARY']);
    expect(errors).toEqual([{ line: 3, message: 'Restricted items need "approval_required_by"' }]);
  });

  it('parses a drug master row and applies defaults', () => {
    const { rows, errors } = parseDrugsCsv(
      'hpt_code,atc_code,generic_name,brand_names,strength,dosage_form,route,pack_size,unit_of_issue\nD-001,A10BA02,Metformin,A|B,500 mg,tablet,oral,100,tablet\nD-002,A10BA,Metformin,,500 mg,tablet,oral,0,tablet',
    );
    expect(rows[0]).toMatchObject({ hptCode: 'D-001', brandNames: ['A', 'B'], dosageForm: 'TABLET', packSize: 100 });
    expect(rows[0]!.controlledSchedule).toBeUndefined(); // blank column: keep current value on update
    expect(errors.map((e) => e.message)).toEqual(['ATC "A10BA" must be a level-5 (substance) code', 'Pack size must be greater than 0']);
  });
});

describe('templates', () => {
  it.each(CONTENT_KINDS)('the %s template parses without errors', (kind) => {
    const t = TEMPLATES[kind];
    const csv = toCsv(t.headers, [t.example]);
    const parser = { atc: parseAtcCsv, hpt: parseHptCsv, interactions: parseInteractionsCsv, contraindications: parseContraindicationsCsv, 'dose-limits': parseDoseLimitsCsv, 'facility-formulary': parseFacilityFormularyCsv, drugs: parseDrugsCsv }[kind];
    const r = parser(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });
});

describe('diffRules', () => {
  it('matches interactions regardless of order and reports changed fields', () => {
    const before = [
      { atcPrefixA: 'B01AA', atcPrefixB: 'M01A', severity: 'MAJOR', description: 'Bleeding', management: null },
      { atcPrefixA: 'C09AA', atcPrefixB: 'C03DA', severity: 'MODERATE', description: 'Hyperkalaemia', management: 'Check K+' },
    ];
    const after = [
      { atcPrefixA: 'M01A', atcPrefixB: 'B01AA', severity: 'CONTRAINDICATED', description: 'Bleeding', management: undefined },
      { atcPrefixA: 'J01MA', atcPrefixB: 'A02AB', severity: 'MINOR', description: 'Chelation' },
    ];
    expect(diffRules('INTERACTION', before, after)).toEqual({
      added: ['A02AB|J01MA'],
      removed: ['C03DA|C09AA'],
      changed: [{ key: 'B01AA|M01A', fields: ['severity'] }],
      unchanged: 0,
    });
  });

  it('compares decimal limits by value', () => {
    const dec = { toString: () => '4000' };
    const r = { atcPrefix: 'N02BE01', doseUnit: 'mg', perKg: false, maxDailyDose: dec, severity: 'WARNING' };
    expect(diffRules('DOSE_LIMIT', [r], [{ ...r, maxDailyDose: 4000 }]).unchanged).toBe(1);
  });
});
