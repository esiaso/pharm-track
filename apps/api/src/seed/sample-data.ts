import { PrismaClient } from '@prisma/client';
import { atcHierarchy, atcLevel } from '../domain/codes';

/**
 * Sample reference data for development and tests.
 *
 * The ATC codes are real WHO ATC codes. The HPT codes are PLACEHOLDERS
 * ("SAMPLE-HPT-xxxx"), not real PPB codes: load the official PPB HPT list
 * through Clinical content → Code sets (POST /api/v1/content/code-sets/hpt/import)
 * for real use. The sample safety rules are format examples, not clinical guidance.
 */
const ATC_NAMES: Record<string, string> = {
  A: 'Alimentary tract and metabolism', A10: 'Drugs used in diabetes', A10B: 'Blood glucose lowering drugs, excl. insulins', A10BA: 'Biguanides', A10BA02: 'metformin',
  B: 'Blood and blood forming organs', B01: 'Antithrombotic agents', B01A: 'Antithrombotic agents', B01AA: 'Vitamin K antagonists', B01AA03: 'warfarin',
  C: 'Cardiovascular system', C08: 'Calcium channel blockers', C08C: 'Selective calcium channel blockers with mainly vascular effects', C08CA: 'Dihydropyridine derivatives', C08CA01: 'amlodipine',
  J: 'Antiinfectives for systemic use', J01: 'Antibacterials for systemic use', J01C: 'Beta-lactam antibacterials, penicillins', J01CA: 'Penicillins with extended spectrum', J01CA04: 'amoxicillin',
  M: 'Musculo-skeletal system', M01: 'Antiinflammatory and antirheumatic products', M01A: 'Antiinflammatory and antirheumatic products, non-steroids', M01AE: 'Propionic acid derivatives', M01AE01: 'ibuprofen',
  N: 'Nervous system', N02: 'Analgesics', N02A: 'Opioids', N02AA: 'Natural opium alkaloids', N02AA01: 'morphine',
  N02B: 'Other analgesics and antipyretics', N02BE: 'Anilides', N02BE01: 'paracetamol',
};

export const SAMPLE_DRUGS = [
  { hptCode: 'SAMPLE-HPT-0001', atcCode: 'J01CA04', genericName: 'Amoxicillin', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', dosageForm: 'CAPSULE', route: 'ORAL', packSize: 100, unitOfIssue: 'CAPSULE', pregnancyRisk: 'SAFE' as const },
  { hptCode: 'SAMPLE-HPT-0002', atcCode: 'A10BA02', genericName: 'Metformin', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 100, unitOfIssue: 'TABLET' },
  { hptCode: 'SAMPLE-HPT-0003', atcCode: 'B01AA03', genericName: 'Warfarin', strength: '5 mg', strengthValue: 5, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 28, unitOfIssue: 'TABLET', pregnancyRisk: 'CONTRAINDICATED' as const },
  { hptCode: 'SAMPLE-HPT-0004', atcCode: 'M01AE01', genericName: 'Ibuprofen', strength: '400 mg', strengthValue: 400, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 100, unitOfIssue: 'TABLET' },
  { hptCode: 'SAMPLE-HPT-0005', atcCode: 'N02BE01', genericName: 'Paracetamol', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 100, unitOfIssue: 'TABLET' },
  { hptCode: 'SAMPLE-HPT-0006', atcCode: 'N02AA01', genericName: 'Morphine', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 30, unitOfIssue: 'TABLET', controlledSchedule: 'SCHEDULE_2' as const },
  { hptCode: 'SAMPLE-HPT-0007', atcCode: 'C08CA01', genericName: 'Amlodipine', strength: '5 mg', strengthValue: 5, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 30, unitOfIssue: 'TABLET', brandNames: ['Brand A'] },
  { hptCode: 'SAMPLE-HPT-0008', atcCode: 'C08CA01', genericName: 'Amlodipine', strength: '5 mg', strengthValue: 5, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 30, unitOfIssue: 'TABLET', brandNames: ['Brand B'] },
];

export async function seedSampleData(prisma: PrismaClient) {
  const codes = new Set(SAMPLE_DRUGS.flatMap((d) => atcHierarchy(d.atcCode)));
  for (const code of [...codes].sort((a, b) => a.length - b.length)) {
    const h = atcHierarchy(code);
    const data = { level: atcLevel(code)!, name: ATC_NAMES[code] ?? code, parentCode: h.length > 1 ? h[h.length - 2]! : null, release: 'SAMPLE' };
    await prisma.atcCode.upsert({ where: { code }, create: { code, ...data }, update: data });
  }
  const group = await prisma.substitutionGroup.upsert({
    where: { id: '00000000-0000-0000-0000-00000000a5c1' },
    create: { id: '00000000-0000-0000-0000-00000000a5c1', name: 'Amlodipine 5 mg tablet' },
    update: {},
  });
  for (const d of SAMPLE_DRUGS) {
    await prisma.hptCode.upsert({ where: { code: d.hptCode }, create: { code: d.hptCode, description: `${d.genericName} ${d.strength} (sample)`, release: 'SAMPLE' }, update: {} });
    const drug = await prisma.drug.upsert({
      where: { hptCode: d.hptCode },
      create: { ...d, brandNames: d.brandNames ?? [], substitutionGroupId: d.atcCode === 'C08CA01' ? group.id : null },
      update: {},
    });
    if (!(await prisma.drugPrice.findFirst({ where: { drugId: drug.id } }))) {
      await prisma.drugPrice.create({ data: { drugId: drug.id, priceListCode: 'DEFAULT', unitPrice: 10, effectiveFrom: new Date('2026-01-01') } });
    }
  }
  if ((await prisma.drugInteraction.count()) === 0) {
    await prisma.drugInteraction.create({
      data: { atcPrefixA: 'B01AA', atcPrefixB: 'M01A', severity: 'MAJOR', description: 'NSAIDs increase bleeding risk with vitamin K antagonists.', management: 'Avoid, or monitor INR closely.' },
    });
    await prisma.contraindication.create({
      data: { atcPrefix: 'M01A', diagnosisSystem: 'ICD10', diagnosisPrefix: 'K25', severity: 'HARD_STOP', rationale: 'NSAIDs worsen gastric ulcer.' },
    });
    await prisma.doseLimitRule.create({
      data: { atcPrefix: 'N02BE01', doseUnit: 'mg', maxSingleDose: 1000, maxDailyDose: 4000, severity: 'WARNING', note: 'Adult paracetamol maximum' },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedSampleData(prisma)
    .then(() => console.log('Sample data loaded.'))
    .finally(() => prisma.$disconnect());
}
