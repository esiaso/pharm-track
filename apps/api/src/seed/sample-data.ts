import { PrismaClient } from '@prisma/client';
import { atcHierarchy, atcLevel } from '../domain/codes';

/**
 * Sample reference data for development and tests.
 *
 * The ATC codes are real WHO ATC codes and the HPT codes are real PPB codes
 * (release of 16 October 2026). CliniTrack prescribes by generic, so each drug
 * carries its generic (GE) code; the second amlodipine is a branded product (PH)
 * in the same substitution group. Load the full PPB HPT list through Clinical
 * content → Code sets for real use. The sample safety rules are format
 * examples, not clinical guidance.
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

/** Names as published in the PPB HPT list. */
const HPT_NAMES: Record<string, string> = {
  GE10160: 'Amoxicillin 500 mg Oral Capsule',
  GE10002: 'Metformin 500 mg Oral Tablet',
  GE10586: 'Warfarin 5 mg Oral Tablet',
  GE10403: 'Ibuprofen 400 mg Oral Tablet',
  GE10177: 'Paracetamol 500 mg Oral Tablet',
  GE12856: 'Morphine 10 mg Oral Tablet',
  GE10012: 'Amlodipine 5 mg Oral Tablet',
  PH10348: 'Amlodeal 5 mg Oral Tablet',
};
const HPT_RELEASE = 'PPB-HPT-2026-10-16';
/** Placeholder codes used before the real list was available; renamed on existing databases. */
const OLD_SAMPLE_CODES: Record<string, string> = {
  'SAMPLE-HPT-0001': 'GE10160',
  'SAMPLE-HPT-0002': 'GE10002',
  'SAMPLE-HPT-0003': 'GE10586',
  'SAMPLE-HPT-0004': 'GE10403',
  'SAMPLE-HPT-0005': 'GE10177',
  'SAMPLE-HPT-0006': 'GE12856',
  'SAMPLE-HPT-0007': 'GE10012',
  'SAMPLE-HPT-0008': 'PH10348',
};

export const SAMPLE_DRUGS = [
  { hptCode: 'GE10160', atcCode: 'J01CA04', genericName: 'Amoxicillin', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', dosageForm: 'CAPSULE', route: 'ORAL', packSize: 100, unitOfIssue: 'CAPSULE', pregnancyRisk: 'SAFE' as const },
  { hptCode: 'GE10002', atcCode: 'A10BA02', genericName: 'Metformin', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 100, unitOfIssue: 'TABLET' },
  { hptCode: 'GE10586', atcCode: 'B01AA03', genericName: 'Warfarin', strength: '5 mg', strengthValue: 5, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 28, unitOfIssue: 'TABLET', pregnancyRisk: 'CONTRAINDICATED' as const },
  { hptCode: 'GE10403', atcCode: 'M01AE01', genericName: 'Ibuprofen', strength: '400 mg', strengthValue: 400, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 100, unitOfIssue: 'TABLET' },
  { hptCode: 'GE10177', atcCode: 'N02BE01', genericName: 'Paracetamol', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 100, unitOfIssue: 'TABLET' },
  { hptCode: 'GE12856', atcCode: 'N02AA01', genericName: 'Morphine', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 30, unitOfIssue: 'TABLET', controlledSchedule: 'SCHEDULE_2' as const },
  { hptCode: 'GE10012', atcCode: 'C08CA01', genericName: 'Amlodipine', strength: '5 mg', strengthValue: 5, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 30, unitOfIssue: 'TABLET', brandNames: [] as string[] },
  { hptCode: 'PH10348', atcCode: 'C08CA01', genericName: 'Amlodipine', strength: '5 mg', strengthValue: 5, strengthUnit: 'mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 30, unitOfIssue: 'TABLET', brandNames: ['Amlodeal'] },
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
    const description = HPT_NAMES[d.hptCode]!;
    await prisma.hptCode.upsert({
      where: { code: d.hptCode },
      create: { code: d.hptCode, description, category: d.hptCode.startsWith('GE') ? 'Generic product' : 'Branded product', ppbStatus: 'ACTIVE', release: HPT_RELEASE },
      update: {},
    });
    // A database seeded with the old placeholder codes keeps its drugs (and their history) under the real code.
    const old = Object.keys(OLD_SAMPLE_CODES).find((k) => OLD_SAMPLE_CODES[k] === d.hptCode)!;
    if (!(await prisma.drug.findUnique({ where: { hptCode: d.hptCode } })) && (await prisma.drug.findUnique({ where: { hptCode: old } }))) {
      await prisma.drug.update({ where: { hptCode: old }, data: { hptCode: d.hptCode, brandNames: d.brandNames ?? [] } });
      await prisma.hptCode.update({ where: { code: old }, data: { retiredInRelease: HPT_RELEASE } });
    }
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
