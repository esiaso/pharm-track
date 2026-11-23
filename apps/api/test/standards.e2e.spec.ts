/**
 * Phase 6: FHIR R4 facade and data protection, against a real PostgreSQL
 * database. Opt-in like the other e2e suites: runs only with E2E_DATABASE_URL
 * and TRUNCATES that database.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createServer, Server } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDays } from '../src/domain/dispensing';
import { REDACTED_SMS } from '../src/domain/retention';
import { ClinitrackClient } from '../src/integrations/clinitrack.client';
import { SmsProvider } from '../src/integrations/sms.provider';
import { SupplyTrackClient } from '../src/integrations/supplytrack.client';
import { NotificationsService } from '../src/refills/notifications.service';
import { seedSampleData } from '../src/seed/sample-data';

const run = process.env.E2E_DATABASE_URL ? describe : describe.skip;
if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;

const H = (roles: string, user: string) => ({ 'x-user-id': user, 'x-user-roles': roles, 'x-facility-id': 'FAC-1' });
const SYSTEM = H('SYSTEM', 'clinitrack');
const PHARMACIST = H('PHARMACIST', 'u-pharm-1');
const ADMIN = H('ADMINISTRATOR', 'u-dpo');
const DAY = 86_400_000;

class FakeSupplyTrack extends SupplyTrackClient {
  async getBatches() {
    return [{ batchNumber: 'B1', expiryDate: addDays(new Date(), 400), quantityAvailable: 10_000 }];
  }
  async reserve() {
    return { reservationId: `res-${Math.random()}`, expiresAt: addDays(new Date(), 1).toISOString() };
  }
  async commit() {}
  async release() {}
  async returnStock() {}
  async submitStockOutReport() {
    return {};
  }
}
class FakeClinitrack extends ClinitrackClient {
  async deliverEvent() {
    return {};
  }
}
class FakeSms extends SmsProvider {
  sent: { to: string; body: string }[] = [];
  async send(to: string, body: string) {
    this.sent.push({ to, body });
    return { providerMessageId: `sms-${this.sent.length}` };
  }
}

run('FHIR facade and data protection end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const sms = new FakeSms();
  let rx: any;
  // A stand-in Zebra printer: collects what arrives on its raw port.
  const printed: string[] = [];
  let printer: Server;

  beforeAll(async () => {
    printer = createServer((sock) => {
      let buf = '';
      sock.on('data', (d) => (buf += d.toString('utf8')));
      sock.on('end', () => printed.push(buf));
    });
    await new Promise<void>((r) => printer.listen(0, '127.0.0.1', () => r()));
    process.env.LABEL_PRINTERS = JSON.stringify({ 'STORE-1': `127.0.0.1:${(printer.address() as any).port}` });
    prisma = new PrismaClient();
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await seedSampleData(prisma);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupplyTrackClient).useValue(new FakeSupplyTrack())
      .overrideProvider(ClinitrackClient).useValue(new FakeClinitrack())
      .overrideProvider(SmsProvider).useValue(sms)
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // One patient with an allergy, a dispensed prescription and an ADR.
    await api().post('/api/v1/allergies').set(SYSTEM)
      .send({ patientId: 'PAT-F1', agentType: 'DRUG_CLASS', atcPrefix: 'J01C', agentText: 'Penicillins', reaction: 'Rash', severity: 'SEVERE', verificationStatus: 'CONFIRMED', externalId: 'CT-ALG-F1' })
      .expect(201);
    const created = await api().post('/api/v1/prescriptions').set(SYSTEM).send({
      externalId: 'CT-RX-F1', patientId: 'PAT-F1', encounterId: 'ENC-F1', prescriberId: 'DR-1', facilityId: 'FAC-1', storeId: 'STORE-1',
      signedAt: new Date().toISOString(), context: { ageMonths: 480, weightKg: 70 },
      items: [{ ref: 'a', hptCode: 'SAMPLE-HPT-0002', atcCode: 'A10BA02', dose: 500, doseUnit: 'mg', frequency: 'BD', frequencyPerDay: 2, route: 'ORAL', durationDays: 30, quantity: 60, refills: 2 }],
    }).expect(201);
    rx = created.body;
    const orderId = rx.dispenseOrders[0].id;
    await api().post(`/api/v1/dispensing/orders/${orderId}/verify`).set(PHARMACIST).send({}).expect(200);
    await api().post(`/api/v1/dispensing/orders/${orderId}/dispense`).set(PHARMACIST)
      .send({ lines: rx.items.map((i: any) => ({ prescriptionItemId: i.id, quantity: 60 })) }).expect(200);
    await api().post('/api/v1/adrs').set(PHARMACIST)
      .send({ patientId: 'PAT-F1', hptCode: 'SAMPLE-HPT-0002', onsetDate: new Date().toISOString(), description: 'Nausea and vomiting', seriousness: 'NON_SERIOUS' })
      .expect(201);
    await prisma.patientAccessLog.deleteMany();
  });

  afterAll(async () => {
    delete process.env.LABEL_PRINTERS;
    printer?.close();
    await app?.close();
    await prisma?.$disconnect();
  });

  const api = () => request(app.getHttpServer());
  const fhir = (path: string, headers: Record<string, string> = SYSTEM) => api().get(`/api/v1/fhir/R4/${path}`).set(headers);

  it('publishes a CapabilityStatement', async () => {
    const res = await fhir('metadata').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
    expect(res.body).toMatchObject({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1' });
  });

  it('searches and reads each resource type for a patient', async () => {
    const mr = await fhir('MedicationRequest?patient=Patient/PAT-F1').expect(200);
    expect(mr.body).toMatchObject({ resourceType: 'Bundle', type: 'searchset', total: 1 });
    const req = mr.body.entry[0].resource;
    expect(req).toMatchObject({ resourceType: 'MedicationRequest', status: 'active', subject: { reference: 'Patient/PAT-F1' }, dispenseRequest: { numberOfRepeatsAllowed: 2 } });

    const md = await fhir(`MedicationDispense?prescription=MedicationRequest/${req.id}`).expect(200);
    expect(md.body.total).toBe(1);
    expect(md.body.entry[0].resource).toMatchObject({ status: 'completed', quantity: { value: 60 }, contained: [{ batch: { lotNumber: 'B1' } }], type: { coding: [{ code: 'FF' }] } });

    const ai = await fhir('AllergyIntolerance?patient=PAT-F1&clinical-status=active').expect(200);
    expect(ai.body.entry[0].resource).toMatchObject({ criticality: 'high', code: { text: 'Penicillins' } });

    const ae = await fhir('AdverseEvent?subject=Patient/PAT-F1').expect(200);
    expect(ae.body.entry[0].resource.seriousness.coding[0].code).toBe('non-serious');

    const medRef = req.medicationReference.reference as string;
    const med = await fhir(medRef).expect(200);
    expect(med.body.code.coding.map((c: any) => c.code)).toEqual(['SAMPLE-HPT-0002', 'A10BA02']);

    const byCode = await fhir('Medication?code=http://www.whocc.no/atc|A10BA02').expect(200);
    expect(byCode.body.total).toBe(1);

    const read = await fhir(`MedicationRequest/${req.id}`, PHARMACIST).expect(200);
    expect(read.body.id).toBe(req.id);
  });

  it('pages search results', async () => {
    const p1 = await fhir('Medication?_count=2').expect(200);
    expect(p1.body.entry).toHaveLength(2);
    const next = p1.body.link.find((l: any) => l.relation === 'next').url as string;
    expect(next).toContain('_offset=2');
  });

  it('returns OperationOutcome errors and refuses searches across all patients', async () => {
    const all = await fhir('AllergyIntolerance').expect(400);
    expect(all.body).toMatchObject({ resourceType: 'OperationOutcome', issue: [{ code: 'invalid' }] });
    expect(all.headers['content-type']).toMatch(/application\/fhir\+json/);
    await fhir('MedicationRequest?patinet=PAT-F1').expect(400);
    const missing = await fhir('AllergyIntolerance/nope').expect(404);
    expect(missing.body.issue[0].code).toBe('not-found');
    await fhir('Patient/PAT-F1').expect(404);
    const forbidden = await fhir('metadata', H('STORE_KEEPER', 'u-store')).expect(403);
    expect(forbidden.body.resourceType).toBe('OperationOutcome');
  });

  it('logs who read which patient, through FHIR and the API', async () => {
    await prisma.patientAccessLog.deleteMany();
    await fhir('AllergyIntolerance?patient=PAT-F1', { ...SYSTEM, 'x-purpose-of-use': 'treatment' }).expect(200);
    await api().get('/api/v1/patients/PAT-F1/allergies').set(PHARMACIST).expect(200);
    await api().get(`/api/v1/dispensing/orders/${rx.dispenseOrders[0].id}`).set(PHARMACIST).expect(200);
    await fhir('Medication?_count=1').expect(200); // no patient data: not logged

    const log = await api().get('/api/v1/privacy/access-log?patientId=PAT-F1').set(ADMIN).expect(200);
    expect(log.body.rows.map((r: any) => [r.actorId, r.action, r.purpose]).reverse()).toEqual([
      ['clinitrack', 'fhir.search', 'TREATMENT'],
      ['u-pharm-1', 'allergies.read', null],
      ['u-pharm-1', 'dispense-order.read', null],
    ]);
    expect(await prisma.patientAccessLog.count()).toBe(3);
    await api().get('/api/v1/privacy/access-log').set(PHARMACIST).expect(403);
  });

  it('exports everything held about a patient', async () => {
    const res = await api().get('/api/v1/privacy/patients/PAT-F1/export').set(ADMIN).expect(200);
    expect(res.body).toMatchObject({ patientId: 'PAT-F1', generatedBy: 'u-dpo' });
    expect(res.body.allergies).toHaveLength(1);
    expect(res.body.prescriptions[0].dispenseOrders[0].lines).toHaveLength(1);
    expect(res.body.adverseDrugReactions).toHaveLength(1);
    expect(res.body.accessLog.length).toBeGreaterThan(0);
    await api().get('/api/v1/privacy/patients/NOBODY/export').set(ADMIN).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'patient.export', entityId: 'PAT-F1' } })).toBe(1);
  });

  it('stops SMS when consent is withdrawn, including messages already queued', async () => {
    await api().put('/api/v1/patients/PAT-F1/contact-preferences').set(SYSTEM).send({ firstName: 'Amina', phone: '0712 345 678', smsOptIn: true }).expect(200);
    const first = await prisma.patientContactPreference.findUniqueOrThrow({ where: { patientId: 'PAT-F1' } });
    await api().put('/api/v1/patients/PAT-F1/contact-preferences').set(SYSTEM).send({ firstName: 'Amina', phone: '0712 345 678', smsOptIn: true, language: 'sw' }).expect(200);
    const again = await prisma.patientContactPreference.findUniqueOrThrow({ where: { patientId: 'PAT-F1' } });
    expect(again.consentRecordedAt).toEqual(first.consentRecordedAt); // consent time kept while consent continues

    const notifications = app.get(NotificationsService);
    await notifications.queue({ patientId: 'PAT-F1', facilityId: 'FAC-1', purpose: 'REFILL_DUE', dedupeKey: 'test-1', vars: { drugName: 'Metformin', dueDate: 'today' } });
    // Consent withdrawn behind PharmTrack's back (no API call): the send-time check catches it.
    await prisma.patientContactPreference.update({ where: { patientId: 'PAT-F1' }, data: { smsOptIn: false } });
    await notifications.sendDue();
    expect(sms.sent).toHaveLength(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { dedupeKey: 'test-1' } })).status).toBe('SKIPPED_NO_CONSENT');

    // Withdrawal through the API cancels queued messages straight away.
    await api().put('/api/v1/patients/PAT-F1/contact-preferences').set(SYSTEM).send({ firstName: 'Amina', phone: '0712 345 678', smsOptIn: true }).expect(200);
    await notifications.queue({ patientId: 'PAT-F1', facilityId: 'FAC-1', purpose: 'REFILL_DUE', dedupeKey: 'test-2', vars: { drugName: 'Metformin', dueDate: 'today' } });
    await api().put('/api/v1/patients/PAT-F1/contact-preferences').set(SYSTEM).send({ firstName: 'Amina', phone: '0712 345 678', smsOptIn: false }).expect(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { dedupeKey: 'test-2' } })).status).toBe('SKIPPED_NO_CONSENT');
  });

  it('erases SMS contact details on request and keeps clinical records', async () => {
    await api().put('/api/v1/patients/PAT-F1/contact-preferences').set(SYSTEM).send({ firstName: 'Amina', phone: '0712 345 678', smsOptIn: true }).expect(200);
    await app.get(NotificationsService).queue({ patientId: 'PAT-F1', facilityId: 'FAC-1', purpose: 'REFILL_DUE', dedupeKey: 'test-3', vars: { drugName: 'Metformin', dueDate: 'today' } });
    await api().post('/api/v1/privacy/patients/PAT-F1/erase-contact').set(ADMIN).send({ reason: 'x' }).expect(400);
    const res = await api().post('/api/v1/privacy/patients/PAT-F1/erase-contact').set(ADMIN).send({ reason: 'Patient asked at the counter' }).expect(200);
    expect(res.body).toMatchObject({ erased: true, stoppedMessages: 1 });
    const pref = await prisma.patientContactPreference.findUniqueOrThrow({ where: { patientId: 'PAT-F1' } });
    expect(pref).toMatchObject({ firstName: null, phoneE164: null, smsOptIn: false });
    expect(pref.erasedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { patientId: 'PAT-F1', toAddress: { not: null } } })).toBe(0);
    expect(await prisma.allergy.count({ where: { patientId: 'PAT-F1' } })).toBe(1);
  });

  it('applies retention: previews, then removes old SMS text, payloads, contact details, logs and patients inactive for 7 years', async () => {
    const old = new Date(Date.now() - 400 * DAY);
    const ancient = new Date(Date.now() - 8 * 365 * DAY);
    await prisma.notification.create({ data: { patientId: 'PAT-OLD', purpose: 'REFILL_DUE', body: 'Habari Juma, metformin is due', toAddress: '+254700000001', status: 'DELIVERED', dedupeKey: 'old-1', createdAt: old } });
    await prisma.outboxEvent.create({ data: { type: 'dispense.completed', destination: 'CLINITRACK', idempotencyKey: 'old-ev-1', payload: { patientId: 'PAT-OLD' }, status: 'DELIVERED', deliveredAt: old } });
    await prisma.outboxEvent.create({ data: { type: 'dispense.completed', destination: 'CLINITRACK', idempotencyKey: 'old-ev-2', payload: { patientId: 'PAT-OLD' }, status: 'DEAD', createdAt: old } });
    await prisma.inboxMessage.create({ data: { idempotencyKey: 'old-in-1', source: 'clinitrack', type: 'POST /x', receivedAt: old, responseBody: { patientId: 'PAT-OLD' } } });
    await prisma.patientContactPreference.create({ data: { patientId: 'PAT-OLD', firstName: 'Juma', phoneE164: '+254700000001', smsOptIn: false } });
    await prisma.$executeRaw`UPDATE "PatientContactPreference" SET "updatedAt" = ${old} WHERE "patientId" = 'PAT-OLD'`;
    await prisma.patientAccessLog.create({ data: { patientId: 'PAT-OLD', actorId: 'x', actorRole: 'PHARMACIST', action: 'allergies.read', path: '/x', at: ancient } });
    await prisma.auditLog.create({ data: { actorId: 'x', actorRole: 'PHARMACIST', action: 'allergy.create', entityType: 'Allergy', entityId: 'gone', at: ancient } });
    // A patient last seen 8 years ago: all of their records go. PAT-F1 (seen today) keeps everything.
    const drug = await prisma.drug.findFirstOrThrow({ where: { hptCode: 'SAMPLE-HPT-0002' } });
    await prisma.allergy.create({ data: { patientId: 'PAT-GONE', agentType: 'NON_DRUG', agentText: 'Latex', severity: 'MILD', recordedBy: 'x', recordedAt: ancient } });
    await prisma.adverseDrugReaction.create({ data: { patientId: 'PAT-GONE', drugId: drug.id, onsetDate: ancient, description: 'Old rash', seriousness: 'NON_SERIOUS', reportedBy: 'x', reportedAt: ancient } });
    await prisma.$executeRaw`UPDATE "Allergy" SET "updatedAt" = ${ancient} WHERE "patientId" = 'PAT-GONE'`;

    const preview = await api().get('/api/v1/privacy/retention').set(ADMIN).expect(200);
    expect(preview.body.due).toEqual({ smsContent: 1, outboxPayloads: 1, idempotencyRecords: 1, contactDetails: 1, accessLogRows: 1, auditLogRows: 1, patients: 1 });
    expect(preview.body.enabled).toBe(false);

    const ran = await api().post('/api/v1/privacy/retention/run').set(ADMIN).expect(200);
    expect(ran.body.removed).toEqual({ smsContent: 1, outboxPayloads: 1, idempotencyRecords: 1, contactDetails: 1, accessLogRows: 1, auditLogRows: 1, patients: 1 });
    expect(await prisma.allergy.count({ where: { patientId: 'PAT-GONE' } })).toBe(0);
    expect(await prisma.adverseDrugReaction.count({ where: { patientId: 'PAT-GONE' } })).toBe(0);
    expect(await prisma.prescription.count({ where: { patientId: 'PAT-F1' } })).toBe(1);
    expect(await prisma.allergy.count({ where: { patientId: 'PAT-F1' } })).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { dedupeKey: 'old-1' } })).body).toBe(REDACTED_SMS);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { idempotencyKey: 'old-ev-1' } })).payload).toEqual({});
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { idempotencyKey: 'old-ev-2' } })).payload).toEqual({ patientId: 'PAT-OLD' });
    expect(await prisma.patientContactPreference.findUniqueOrThrow({ where: { patientId: 'PAT-OLD' } })).toMatchObject({ phoneE164: null, firstName: null });

    const after = await api().get('/api/v1/privacy/retention').set(ADMIN).expect(200);
    expect(after.body.due).toEqual({ smsContent: 0, outboxPayloads: 0, idempotencyRecords: 0, contactDetails: 0, accessLogRows: 0, auditLogRows: 0, patients: 0 });
    expect(after.body.lastRun).toMatchObject({ trigger: 'MANUAL', actorId: 'u-dpo' });
  });

  it('makes Zebra labels for a dispensed order, as a file or sent to the store printer', async () => {
    const orderId = rx.dispenseOrders[0].id;
    await prisma.facilityProfile.upsert({ where: { facilityId: 'FAC-1' }, create: { facilityId: 'FAC-1', name: 'Kisumu Hospital Pharmacy', phone: '0700 000 000' }, update: {} });
    await prisma.patientAccessLog.deleteMany();

    const file = await api().get(`/api/v1/dispensing/orders/${orderId}/labels.zpl?patientName=Amina%20Otieno&copies=2`).set(PHARMACIST).expect(200);
    expect(file.headers['content-type']).toMatch(/application\/vnd\.zebra\.zpl/);
    expect(file.headers['content-disposition']).toMatch(/labels-.*\.zpl/);
    expect(file.text).toMatch(/^\^XA/);
    expect(file.text).toContain('For: Amina Otieno');
    expect(file.text).toContain('Metformin');
    expect(file.text).toContain('Batch B1');
    expect(file.text).toContain('^PQ2');
    expect(file.text).toContain('Kisumu Hospital Pharmacy');
    expect(await prisma.patientAccessLog.count({ where: { patientId: 'PAT-F1', action: 'labels.download' } })).toBe(1);

    const stores = await api().get('/api/v1/dispensing/label-printers').set(PHARMACIST).expect(200);
    expect(stores.body).toEqual({ stores: ['STORE-1'] });
    const res = await api().post(`/api/v1/dispensing/orders/${orderId}/labels/print`).set(PHARMACIST).send({}).expect(200);
    expect(res.body).toMatchObject({ printed: 1, storeId: 'STORE-1' });
    for (let i = 0; i < 20 && !printed.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(printed[0]).toMatch(/^\^XA[\s\S]*\^XZ$/);
    expect(printed[0]).toContain('For: PAT-F1');
    expect(await prisma.auditLog.count({ where: { action: 'labels.print', entityId: orderId } })).toBe(1);

    await api().post(`/api/v1/dispensing/orders/${orderId}/labels/print`).set(PHARMACIST).send({ copies: 50 }).expect(400);
  });
  it('lets an administrator set the facility profile and SMS wording, including wording without the medicine name', async () => {
    const base = '/api/v1/facilities/FAC-SET';
    await api().put(`${base}/profile`).set(PHARMACIST).send({ name: 'Nope' }).expect(403);
    await api().put(`${base}/profile`).set(ADMIN).send({ name: 'Riverside Clinic', phone: ' 0711 000 111 ' }).expect(200);
    expect((await api().get(`${base}/profile`).set(PHARMACIST).expect(200)).body).toMatchObject({ name: 'Riverside Clinic', phone: '0711 000 111' });

    const before = (await api().get(`${base}/sms-templates`).set(ADMIN).expect(200)).body;
    expect(before.templates).toHaveLength(8);
    const reminder = before.templates.find((t: any) => t.purpose === 'REFILL_REMINDER' && t.language === 'en');
    expect(reminder).toMatchObject({ source: 'default', namesMedicine: true });

    const bad = await api().put('/api/v1/sms-templates').set(ADMIN).send({ facilityId: 'FAC-SET', purpose: 'REFILL_REMINDER', language: 'en', body: 'Hello {{name}}, come in soon please.' }).expect(400);
    expect(bad.body.message).toMatch(/\{\{name\}\}/);

    await api().put('/api/v1/sms-templates').set(ADMIN).send({ facilityId: 'FAC-SET', purpose: 'REFILL_REMINDER', language: 'en', body: reminder.privateBody }).expect(200);
    const after = (await api().get(`${base}/sms-templates`).set(ADMIN).expect(200)).body.templates.find((t: any) => t.purpose === 'REFILL_REMINDER' && t.language === 'en');
    expect(after).toMatchObject({ source: 'facility', namesMedicine: false });

    // A queued reminder uses the facility's wording and profile, and does not name the medicine.
    await prisma.patientContactPreference.upsert({
      where: { patientId: 'PAT-SET' },
      create: { patientId: 'PAT-SET', firstName: 'Amina', phoneE164: '+254711000111', smsOptIn: true, language: 'en' },
      update: {},
    });
    const n = await app.get(NotificationsService).queue({ patientId: 'PAT-SET', facilityId: 'FAC-SET', purpose: 'REFILL_REMINDER', dedupeKey: 'set-1', vars: { drugName: 'Tenofovir', dueDate: '1 Dec 2026' } });
    expect(n.body).toContain('Riverside Clinic');
    expect(n.body).not.toContain('Tenofovir');

    await api().delete(`${base}/sms-templates/REFILL_REMINDER/en`).set(ADMIN).expect(200);
    await api().delete(`${base}/sms-templates/NOPE/en`).set(ADMIN).expect(400);
    expect((await api().get(`${base}/sms-templates`).set(ADMIN).expect(200)).body.templates.find((t: any) => t.purpose === 'REFILL_REMINDER' && t.language === 'en').source).toBe('default');
    expect(await prisma.auditLog.count({ where: { action: { in: ['facility-profile.update', 'sms-template.update', 'sms-template.reset'] }, actorId: 'u-dpo' } })).toBe(3);
  });
  it("takes delivery reports from Africa's Talking only with the webhook token", async () => {
    process.env.SMS_WEBHOOK_SECRET = 'a-long-webhook-secret';
    const n = await prisma.notification.create({
      data: { patientId: 'PAT-AT', purpose: 'READY_FOR_COLLECTION', channel: 'SMS', body: 'Ready', dedupeKey: 'at-1', status: 'SENT', providerMessageId: 'ATXid_e2e' },
    });
    const url = '/api/v1/notifications/sms/africastalking/delivery-reports';
    const form = 'id=ATXid_e2e&status=Success&phoneNumber=%2B254711000111&networkCode=63902&retryCount=0';
    await api().post(url).type('form').send(form).expect(401);
    await api().post(`${url}?token=wrong-token-wrong-token`).type('form').send(form).expect(401);
    // Intermediate statuses change nothing.
    expect((await api().post(`${url}?token=a-long-webhook-secret`).type('form').send('id=ATXid_e2e&status=Buffered').expect(200)).body).toEqual({ updated: false });
    expect((await api().post(`${url}?token=a-long-webhook-secret`).type('form').send(form).expect(200)).body).toEqual({ updated: true });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('DELIVERED');
    delete process.env.SMS_WEBHOOK_SECRET;
  });

  it('fails an SMS at once when the gateway refuses it for good', async () => {
    await prisma.patientContactPreference.upsert({
      where: { patientId: 'PAT-AT2' },
      create: { patientId: 'PAT-AT2', firstName: 'Juma', phoneE164: '+254711000222', smsOptIn: true, language: 'en' },
      update: {},
    });
    const notifications = app.get(NotificationsService);
    const n = await notifications.queue({ patientId: 'PAT-AT2', facilityId: 'FAC-1', purpose: 'READY_FOR_COLLECTION', dedupeKey: 'at-2', vars: {} });
    const real = sms.send.bind(sms);
    const send = jest.spyOn(sms, 'send').mockImplementation(async (to: string, body: string) => {
      if (to === '+254711000222') throw Object.assign(new Error('InvalidPhoneNumber (403)'), { retryable: false });
      return real(to, body);
    });
    await notifications.sendDue();
    send.mockRestore();
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ status: 'FAILED', attempts: 1 });
  });
  it('lets a consultant override a hard stop only where the facility allows it, and records who', async () => {
    const rx = (over: Record<string, unknown> = {}) => ({
      externalId: `CT-RX-HS-${Math.random().toString(36).slice(2)}`,
      patientId: 'PAT-HS',
      encounterId: 'ENC-HS',
      prescriberId: 'dr.otieno',
      facilityId: 'FAC-HS',
      storeId: 'STORE-1',
      signedAt: new Date().toISOString(),
      context: { ageMonths: 480, weightKg: 70, diagnoses: [{ system: 'ICD10', code: 'K25.9' }] },
      items: [{ ref: 'L1', hptCode: 'SAMPLE-HPT-0004', atcCode: 'M01AE01', dose: 400, doseUnit: 'mg', frequency: 'TDS', frequencyPerDay: 3, route: 'ORAL', durationDays: 3, quantity: 9 }],
      ...over,
    });

    // Off by default: blocked, and nothing is overridable.
    const off = await api().post('/api/v1/prescriptions').set(SYSTEM).send(rx()).expect(422);
    expect(off.body.blocking[0].type).toBe('CONTRAINDICATION');
    expect(off.body.overridable).toEqual([]);
    const key = off.body.blocking[0].key;
    await api().post('/api/v1/prescriptions').set(SYSTEM)
      .send(rx({ overrides: [{ key, reason: 'Short course with PPI cover, reviewed', authorisedBy: 'dr.consultant' }] }))
      .expect(422);

    // The administrator turns it on for the facility.
    await api().put('/api/v1/facilities/FAC-HS/profile').set(ADMIN).send({ name: 'HS Clinic', allowHardStopOverride: true }).expect(200);
    const on = await api().post('/api/v1/prescriptions').set(SYSTEM).send(rx()).expect(422);
    expect(on.body.overridable).toEqual([key]);
    const created = await api().post('/api/v1/prescriptions').set(SYSTEM)
      .send(rx({ overrides: [{ key, reason: 'Short course with PPI cover, reviewed', authorisedBy: 'dr.consultant' }] }))
      .expect(201);
    expect(created.body.items[0].safetyAlerts[0]).toMatchObject({ severity: 'HARD_STOP', overrideAuthorisedBy: 'dr.consultant' });

    // At verification the hard stop fires again; the pharmacist cannot name themselves as the consultant.
    const orderId = created.body.dispenseOrders[0].id;
    const pharm = H('PHARMACIST', 'u-pharm-hs');
    const v1 = await api().post(`/api/v1/dispensing/orders/${orderId}/verify`).set(pharm).send({}).expect(422);
    expect(v1.body.overridable).toEqual([v1.body.blocking[0].key]);
    const vkey = v1.body.blocking[0].key;
    await api().post(`/api/v1/dispensing/orders/${orderId}/verify`).set(pharm)
      .send({ overrides: [{ key: vkey, reason: 'Consultant confirmed by phone, PPI given', authorisedBy: 'u-pharm-hs' }] })
      .expect(422);
    await api().post(`/api/v1/dispensing/orders/${orderId}/verify`).set(pharm)
      .send({ overrides: [{ key: vkey, reason: 'Consultant confirmed by phone, PPI given', authorisedBy: 'dr.consultant' }] })
      .expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'safety.hard-stop-override' } })).toBe(2);
  });
});
