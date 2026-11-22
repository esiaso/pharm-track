/**
 * Clinical content management (phase 4) against a real PostgreSQL database.
 * Opt-in like flow.e2e.spec.ts: runs only with E2E_DATABASE_URL and TRUNCATES it.
 *
 * Rules and codes used here are test fixtures for exercising the import
 * machinery, not clinical guidance.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ClinitrackClient } from '../src/integrations/clinitrack.client';
import { SupplyTrackClient } from '../src/integrations/supplytrack.client';
import { seedSampleData } from '../src/seed/sample-data';

const run = process.env.E2E_DATABASE_URL ? describe : describe.skip;
if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;

const H = (roles: string, user: string) => ({ 'x-user-id': user, 'x-user-roles': roles, 'x-facility-id': 'FAC-1' });
const ADMIN = H('ADMINISTRATOR', 'u-admin');
const PHARM_A = H('PHARMACIST', 'u-pharm-a');
const PHARM_B = H('PHARMACIST', 'u-pharm-b');
const csv = (...lines: string[]) => lines.join('\n') + '\n';

run('Clinical content end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await seedSampleData(prisma);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupplyTrackClient).useValue({})
      .overrideProvider(ClinitrackClient).useValue({ deliverEvent: async () => ({}) })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const api = () => request(app.getHttpServer());
  const check = (items: { hptCode: string; dose: number }[]) =>
    api()
      .post('/api/v1/safety/check')
      .set(H('PRESCRIBER', 'dr-1'))
      .send({ patientId: 'PAT-CONTENT', context: { ageMonths: 480, weightKg: 70 }, items: items.map((i, n) => ({ ref: `r${n}`, ...i, doseUnit: 'mg', frequencyPerDay: 1, route: 'ORAL' })) })
      .expect(200);

  it('offers CSV templates and limits who can import', async () => {
    const t = await api().get('/api/v1/content/templates/interactions').set(PHARM_A).expect(200);
    expect(t.headers['content-type']).toMatch(/text\/csv/);
    expect(t.text.split('\r\n')[0]).toBe('atc_a,atc_b,severity,description,management,ref');
    await api().get('/api/v1/content/templates/nope').set(PHARM_A).expect(400);
    await api().post('/api/v1/content/code-sets/atc/import').set(PHARM_A).send({ release: 'X', csv: 'a' }).expect(403);
    await api().post('/api/v1/content/rule-sets/import').set(H('PRESCRIBER', 'dr-1')).send({}).expect(403);
  });

  it('loads WHO ATC codes with several DDDs, and a dry run writes nothing', async () => {
    const file = csv(
      'ATC code,ATC level name,DDD,U,Adm.R,Note',
      'N02BB,Pyrazolones,,,,',
      'N02BB02,metamizole sodium,3,g,O,',
      'N02BB02,metamizole sodium,3,g,P,',
      'N02BE01,paracetamol,3,g,O,',
      'N02BE01,paracetamol,3,g,R,',
      'N02ZZ99,orphan,,,,',
    );
    const dry = await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-1', csv: file, dryRun: true }).expect(201);
    expect(dry.body).toMatchObject({ dryRun: true, created: 2, updated: 1, failed: 1, retired: 0 });
    expect(dry.body.errors[0].message).toMatch(/Parent N02ZZ of N02ZZ99/);
    expect(await prisma.atcCode.findUnique({ where: { code: 'N02BB02' } })).toBeNull();

    const res = await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-1', csv: file }).expect(201);
    expect(res.body.importId).toBeDefined();
    const metamizole = await prisma.atcCode.findUnique({ where: { code: 'N02BB02' }, include: { ddds: true } });
    expect(metamizole).toMatchObject({ level: 5, parentCode: 'N02BB', dddRoute: 'O' });
    expect(metamizole!.ddds.map((d) => d.route).sort()).toEqual(['O', 'P']);
    expect(Number((await prisma.atcCode.findUnique({ where: { code: 'N02BE01' } }))!.ddd)).toBe(3);

    // Loading the same file again changes nothing.
    const again = await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-1', csv: file, dryRun: true }).expect(201);
    expect(again.body).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  it('retires codes missing from a full release and shows which drugs use them', async () => {
    const all = await prisma.atcCode.findMany({ orderBy: { code: 'asc' } });
    const without = (codes: string[]) => csv('atc_code,atc_level_name', ...all.filter((c) => !codes.includes(c.code)).map((c) => `${c.code},${c.name}`));

    const bad = csv('atc_code,atc_level_name', ...all.map((c) => `${c.code},${c.name}`), 'X1,broken');
    await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-2', mode: 'FULL', csv: bad }).expect(422);

    const tiny = csv('atc_code,atc_level_name', 'A,ALIMENTARY TRACT AND METABOLISM');
    const guard = await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-2', mode: 'FULL', csv: tiny }).expect(422);
    expect(guard.body.message).toMatch(/would retire \d+ of \d+/);

    const file = without(['M01AE01']);
    const dry = await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-2', mode: 'FULL', csv: file, dryRun: true }).expect(201);
    expect(dry.body.retiredCodes).toEqual(['M01AE01']);
    expect(dry.body.affectedDrugs).toEqual([expect.objectContaining({ hptCode: 'SAMPLE-HPT-0004', reason: 'ATC code M01AE01 is not in TEST-ATC-2' })]);

    await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-2', mode: 'FULL', csv: file }).expect(201);
    expect((await prisma.atcCode.findUnique({ where: { code: 'M01AE01' } }))!.retiredInRelease).toBe('TEST-ATC-2');
    expect((await prisma.atcCode.findUnique({ where: { code: 'A10BA02' } }))!.release).toBe('TEST-ATC-2');

    const review = await api().get('/api/v1/content/code-sets/drugs-needing-review').set(PHARM_A).expect(200);
    expect(review.body.map((d: any) => d.hptCode)).toEqual(['SAMPLE-HPT-0004']);

    // New drugs cannot use a retired code.
    await api().post('/api/v1/formulary/drugs').set(PHARM_A)
      .send({ hptCode: 'SAMPLE-HPT-0001', atcCode: 'M01AE01', genericName: 'X', strength: '1 mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 1, unitOfIssue: 'TABLET' })
      .expect((r) => expect([400, 409]).toContain(r.status));

    // A later release that lists the code again reinstates it.
    await api().post('/api/v1/content/code-sets/atc/import').set(ADMIN).send({ release: 'TEST-ATC-3', csv: csv('atc_code,atc_level_name', 'M01AE01,ibuprofen') }).expect(201);
    expect((await prisma.atcCode.findUnique({ where: { code: 'M01AE01' } }))!.retiredInRelease).toBeNull();

    const imports = await api().get('/api/v1/content/code-sets/imports').set(PHARM_A).expect(200);
    expect(imports.body[0]).toMatchObject({ codeSystem: 'WHO_ATC', release: 'TEST-ATC-3', mode: 'PARTIAL' });
    expect(imports.body.find((i: any) => i.release === 'TEST-ATC-2')).toMatchObject({ mode: 'FULL', rowsRetired: 1 });
  });

  it('loads PPB HPT codes and flags drugs whose product PPB has withdrawn', async () => {
    const res = await api().post('/api/v1/content/code-sets/hpt/import').set(ADMIN)
      .send({ release: 'TEST-HPT-1', csv: csv('HPT Code,Description,Status', 'TEST-HPT-0100,Metformin 1 g tablet,Registered', 'SAMPLE-HPT-0006,Morphine 10 mg tablet,Withdrawn', 'bad code!,x,') })
      .expect(201);
    expect(res.body).toMatchObject({ created: 1, updated: 1, failed: 1 });
    expect(res.body.affectedDrugs).toEqual([expect.objectContaining({ hptCode: 'SAMPLE-HPT-0006', reason: 'PPB status of SAMPLE-HPT-0006 is WITHDRAWN' })]);
    const review = await api().get('/api/v1/content/code-sets/drugs-needing-review').set(PHARM_A).expect(200);
    expect(review.body.find((d: any) => d.hptCode === 'SAMPLE-HPT-0006').reason).toBe('PPB status WITHDRAWN');
  });

  it('keeps an imported rule set as a draft until a second pharmacist approves it', async () => {
    const rules = (severity: string) => csv('atc_a,atc_b,severity,description,management,ref', `C08CA,A10BA,${severity},Test interaction (fixture),Test management,T-1`);
    const amlodipineMetformin = [{ hptCode: 'SAMPLE-HPT-0007', dose: 5 }, { hptCode: 'SAMPLE-HPT-0002', dose: 500 }];
    const interactionAlerts = async () => (await check(amlodipineMetformin)).body.alerts.filter((a: any) => a.type === 'INTERACTION');

    const badFile = csv('atc_a,atc_b,severity,description', 'C08CA,A11,MAJOR,x', 'C08CA,Q1,MAJOR,x');
    const dry = await api().post('/api/v1/content/rule-sets/import').set(PHARM_A)
      .send({ kind: 'INTERACTION', name: 'Test', source: 'Test MTC', version: '1', csv: badFile, dryRun: true }).expect(201);
    expect(dry.body.errors.map((e: any) => e.message)).toEqual(['ATC A11 is not in the loaded WHO ATC code set', 'ATC B "Q1" is not a valid ATC code or class']);
    await api().post('/api/v1/content/rule-sets/import').set(PHARM_A).send({ kind: 'INTERACTION', name: 'Test', source: 'Test MTC', version: '1', csv: badFile }).expect(422);

    const v1 = await api().post('/api/v1/content/rule-sets/import').set(PHARM_A)
      .send({ kind: 'INTERACTION', name: 'Test interactions', source: 'Test MTC', version: '1', csv: rules('MODERATE') }).expect(201);
    const id1 = v1.body.ruleSet.id;
    expect(v1.body.ruleSet.status).toBe('DRAFT');
    expect(await interactionAlerts()).toEqual([]);
    await api().post('/api/v1/content/rule-sets/import').set(PHARM_A)
      .send({ kind: 'INTERACTION', name: 'dup', source: 'Test MTC', version: '1', csv: rules('MODERATE') }).expect(409);

    const self = await api().post(`/api/v1/content/rule-sets/${id1}/activate`).set(PHARM_A).expect(403);
    expect(self.body.message).toMatch(/different pharmacist/);
    await api().post(`/api/v1/content/rule-sets/${id1}/activate`).set(PHARM_B).expect(201);
    await api().post(`/api/v1/content/rule-sets/${id1}/activate`).set(PHARM_B).expect(409);
    expect((await interactionAlerts()).map((a: any) => a.severity)).toEqual(['WARNING']);

    // Version 2 changes the severity; the reviewer sees what changed.
    const v2 = await api().post('/api/v1/content/rule-sets/import').set(PHARM_A)
      .send({ kind: 'INTERACTION', name: 'Test interactions', source: 'Test MTC', version: '2', csv: rules('CONTRAINDICATED') }).expect(201);
    const id2 = v2.body.ruleSet.id;
    const detail = await api().get(`/api/v1/content/rule-sets/${id2}`).set(PHARM_B).expect(200);
    expect(detail.body.comparedTo).toMatchObject({ ruleSetId: id1, added: 0, removed: 0, changed: 1, changedRules: [{ key: 'A10BA|C08CA', fields: ['severity'] }] });
    expect(detail.body.ruleCount).toBe(1);

    const act = await api().post(`/api/v1/content/rule-sets/${id2}/activate`).set(PHARM_B).expect(201);
    expect(act.body.retiredRuleSetIds).toEqual([id1]);
    expect((await interactionAlerts()).map((a: any) => a.severity)).toEqual(['HARD_STOP']);

    const exported = await api().get(`/api/v1/content/rule-sets/${id2}/export`).set(PHARM_A).expect(200);
    expect(exported.text).toContain('C08CA,A10BA,CONTRAINDICATED,Test interaction (fixture),Test management,T-1');

    await api().post(`/api/v1/content/rule-sets/${id2}/retire`).set(PHARM_A).send({ reason: 'x' }).expect(400);
    await api().post(`/api/v1/content/rule-sets/${id2}/retire`).set(PHARM_A).send({ reason: 'Withdrawn by MTC' }).expect(201);
    expect(await interactionAlerts()).toEqual([]);

    const list = await api().get('/api/v1/content/rule-sets?kind=INTERACTION').set(PHARM_A).expect(200);
    expect(list.body.ruleSets.map((s: any) => [s.version, s.status])).toEqual([['2', 'RETIRED'], ['1', 'RETIRED']]);
    expect(list.body.unmanaged.INTERACTION).toBe(1); // the seeded sample rule
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'RuleSet' }, orderBy: { at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['ruleset.import', 'ruleset.activate', 'ruleset.import', 'ruleset.activate', 'ruleset.retire']);
  });

  it('maps dose-limit rules for one product to the drug by HPT code', async () => {
    const file = csv('hpt_code,atc,dose_unit,max_single_dose,max_daily_dose,severity', 'SAMPLE-HPT-0002,,mg,100,200,HARD_STOP', 'NOT-A-DRUG,,mg,1,2,');
    const dry = await api().post('/api/v1/content/rule-sets/import').set(PHARM_A).send({ kind: 'DOSE_LIMIT', name: 'Doses', source: 'Test MTC', version: '1', csv: file, dryRun: true }).expect(201);
    expect(dry.body.errors).toEqual([{ line: 3, message: 'No drug with HPT code NOT-A-DRUG in the drug master' }]);
    const ok = await api().post('/api/v1/content/rule-sets/import').set(PHARM_A)
      .send({ kind: 'DOSE_LIMIT', name: 'Doses', source: 'Test MTC', version: '1', csv: csv('hpt_code,atc,dose_unit,max_single_dose,max_daily_dose,severity', 'SAMPLE-HPT-0002,,mg,100,200,HARD_STOP') })
      .expect(201);
    await api().post(`/api/v1/content/rule-sets/${ok.body.ruleSet.id}/activate`).set(PHARM_B).expect(201);
    const alerts = (await check([{ hptCode: 'SAMPLE-HPT-0002', dose: 500 }])).body.alerts;
    expect(alerts.some((a: any) => a.type === 'DOSE_LIMIT' && a.severity === 'HARD_STOP')).toBe(true);
    const exported = await api().get(`/api/v1/content/rule-sets/${ok.body.ruleSet.id}/export`).set(PHARM_A).expect(200);
    expect(exported.text.split('\r\n')[1]).toMatch(/^SAMPLE-HPT-0002,,/);
  });

  it('bulk loads a facility formulary, and a full load removes items not listed', async () => {
    const url = '/api/v1/content/facilities/FAC-2/formulary/import';
    const partial = await api().post(url).set(PHARM_A)
      .send({ csv: csv('hpt_code,status,approval_required_by,restriction_note', 'SAMPLE-HPT-0001,RESTRICTED,CONSULTANT,Culture-guided', 'SAMPLE-HPT-0002,ACTIVE,,', 'SAMPLE-HPT-0005,RESTRICTED,,', 'UNKNOWN-1,ACTIVE,,') })
      .expect(201);
    expect(partial.body).toMatchObject({ created: 2, failed: 2 });
    const exported = await api().get('/api/v1/content/facilities/FAC-2/formulary/export').set(PHARM_A).expect(200);
    expect(exported.text).toContain('SAMPLE-HPT-0001,RESTRICTED,CONSULTANT,Culture-guided,Amoxicillin');

    const full = csv('hpt_code,status', 'SAMPLE-HPT-0002,NON_FORMULARY');
    const dry = await api().post(url).set(PHARM_A).send({ csv: full, mode: 'FULL', dryRun: true }).expect(201);
    expect(dry.body).toMatchObject({ updated: 1, retired: 1, retiredCodes: ['SAMPLE-HPT-0001'] });
    await api().post(url).set(PHARM_A).send({ csv: full, mode: 'FULL' }).expect(201);
    const entries = await prisma.facilityFormulary.findMany({ where: { facilityId: 'FAC-2' }, include: { drug: true } });
    expect(entries.map((e) => [e.drug.hptCode, e.status])).toEqual([['SAMPLE-HPT-0002', 'NON_FORMULARY']]);
  });

  it('bulk creates and updates drugs through the normal versioned path', async () => {
    const file = csv(
      'hpt_code,atc_code,generic_name,strength,dosage_form,route,pack_size,unit_of_issue,pregnancy_risk',
      'TEST-HPT-0100,A10BA02,Metformin,1 g,TABLET,ORAL,60,TABLET,',
      'SAMPLE-HPT-0005,N02BE01,Paracetamol,500 mg,TABLET,ORAL,1000,TABLET,',
      'SAMPLE-HPT-0001,J01CA04,Amoxicillin,500 mg,CAPSULE,ORAL,100,CAPSULE,',
      'NOT-LOADED-1,A10BA02,Metformin,1 g,TABLET,ORAL,60,TABLET,',
    );
    const dry = await api().post('/api/v1/content/drugs/import').set(PHARM_A).send({ csv: file, reason: 'Pack size update', dryRun: true }).expect(201);
    expect(dry.body).toMatchObject({ created: 1, updated: 1, unchanged: 1, failed: 1 });
    expect(dry.body.changes).toEqual([
      { line: 2, hptCode: 'TEST-HPT-0100', action: 'create', fields: [] },
      { line: 3, hptCode: 'SAMPLE-HPT-0005', action: 'update', fields: ['packSize'] },
    ]);

    await api().post('/api/v1/content/drugs/import').set(PHARM_A).send({ csv: file, reason: 'Pack size update' }).expect(201);
    const para = await prisma.drug.findUnique({ where: { hptCode: 'SAMPLE-HPT-0005' }, include: { versions: { orderBy: { version: 'desc' } } } });
    expect(para).toMatchObject({ packSize: 1000, pregnancyRisk: 'UNKNOWN', version: 2 });
    expect(para!.versions[0]).toMatchObject({ reason: 'Pack size update', changedBy: 'u-pharm-a' });
    expect(await prisma.drug.findUnique({ where: { hptCode: 'TEST-HPT-0100' } })).toMatchObject({ genericName: 'Metformin', formularyStatus: 'ACTIVE' });
    const events = await prisma.outboxEvent.findMany({ where: { type: 'drug.upserted' } });
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
