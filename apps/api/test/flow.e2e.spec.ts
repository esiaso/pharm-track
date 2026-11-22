/**
 * End-to-end flow against a real PostgreSQL database, with SupplyTrack,
 * CliniTrack and the SMS gateway replaced by in-memory fakes.
 *
 * Opt-in: runs only when E2E_DATABASE_URL is set. It TRUNCATES every table in
 * that database, so never point it at a database you care about.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDays, startOfDay } from '../src/domain/dispensing';
import { ClinitrackClient } from '../src/integrations/clinitrack.client';
import { OutboxService } from '../src/integrations/outbox.service';
import { SmsProvider } from '../src/integrations/sms.provider';
import { SupplyTrackClient } from '../src/integrations/supplytrack.client';
import { NotificationsService } from '../src/refills/notifications.service';
import { RefillsService } from '../src/refills/refills.service';
import { seedSampleData } from '../src/seed/sample-data';

const run = process.env.E2E_DATABASE_URL ? describe : describe.skip;
if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;

class FakeSupplyTrack extends SupplyTrackClient {
  reservations: { id: string; hptCode: string; quantity: number; committed: boolean; released: boolean }[] = [];
  returns: unknown[] = [];
  async getBatches() {
    return [
      { batchNumber: 'LATE', expiryDate: addDays(new Date(), 400), quantityAvailable: 1000 },
      { batchNumber: 'SOON', expiryDate: addDays(new Date(), 200), quantityAvailable: 50 },
    ];
  }
  async reserve(req: Parameters<SupplyTrackClient['reserve']>[0]) {
    const id = `res-${this.reservations.length + 1}`;
    this.reservations.push({ id, hptCode: req.hptCode, quantity: req.allocations.reduce((s, a) => s + a.quantity, 0), committed: false, released: false });
    return { reservationId: id, expiresAt: addDays(new Date(), 1).toISOString() };
  }
  async commit(id: string) {
    this.reservations.find((r) => r.id === id)!.committed = true;
  }
  async release(id: string) {
    this.reservations.find((r) => r.id === id)!.released = true;
  }
  async returnStock(req: unknown) {
    this.returns.push(req);
  }
}

class FakeClinitrack extends ClinitrackClient {
  events: { type: string; payload: any }[] = [];
  async deliverEvent(type: string, payload: unknown) {
    this.events.push({ type, payload });
    return { reference: `CT-${this.events.length}` };
  }
}

class FakeSms extends SmsProvider {
  sent: { to: string; body: string }[] = [];
  async send(to: string, body: string, reference: string) {
    this.sent.push({ to, body });
    return { providerMessageId: `sms-${reference}` };
  }
}

const H = (roles: string, user = 'u-pharm-1') => ({ 'x-user-id': user, 'x-user-roles': roles, 'x-facility-id': 'FAC-1' });
const SYSTEM = H('SYSTEM', 'clinitrack');
const PHARMACIST = H('PHARMACIST');

run('PharmTrack end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const supply = new FakeSupplyTrack();
  const clinitrack = new FakeClinitrack();
  const sms = new FakeSms();

  beforeAll(async () => {
    prisma = new PrismaClient();
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await seedSampleData(prisma);

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupplyTrackClient).useValue(supply)
      .overrideProvider(ClinitrackClient).useValue(clinitrack)
      .overrideProvider(SmsProvider).useValue(sms)
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
  const prescription = (over: Record<string, unknown> = {}) => ({
    externalId: `CT-RX-${Math.random().toString(36).slice(2)}`,
    patientId: 'PAT-1',
    encounterId: 'ENC-1',
    prescriberId: 'DR-1',
    facilityId: 'FAC-1',
    storeId: 'STORE-1',
    signedAt: new Date().toISOString(),
    context: { ageMonths: 480, weightKg: 70, diagnoses: [{ system: 'ICD10', code: 'E11.9' }] },
    items: [
      { ref: 'L1', hptCode: 'SAMPLE-HPT-0002', atcCode: 'A10BA02', dose: 500, doseUnit: 'mg', frequency: 'BD', frequencyPerDay: 2, route: 'ORAL', durationDays: 30, quantity: 60, refills: 2 },
      { ref: 'L2', hptCode: 'SAMPLE-HPT-0001', atcCode: 'J01CA04', dose: 500, doseUnit: 'mg', frequency: 'TDS', frequencyPerDay: 3, route: 'ORAL', durationDays: 7, quantity: 21 },
    ],
    ...over,
  });

  it('rejects calls without credentials and with the wrong role', async () => {
    await api().get('/api/v1/formulary/drugs').expect(401);
    await api().post('/api/v1/formulary/drugs').set(H('PRESCRIBER')).send({}).expect(403);
  });

  it('searches the formulary by name, ATC class and HPT code', async () => {
    const byName = await api().get('/api/v1/formulary/drugs?q=amox').set(PHARMACIST).expect(200);
    expect(byName.body.map((d: any) => d.hptCode)).toEqual(['SAMPLE-HPT-0001']);
    const byClass = await api().get('/api/v1/formulary/drugs?q=N02').set(PHARMACIST).expect(200);
    expect(byClass.body).toHaveLength(2);
    const byHpt = await api().get('/api/v1/formulary/drugs/by-hpt/sample-hpt-0003').set(PHARMACIST).expect(200);
    expect(byHpt.body.atcHierarchy).toEqual(['B', 'B01', 'B01A', 'B01AA', 'B01AA03']);
  });

  it('validates ATC and HPT codes when creating a drug and versions changes', async () => {
    await api().post('/api/v1/formulary/drugs').set(PHARMACIST)
      .send({ hptCode: 'SAMPLE-HPT-0099', atcCode: 'J01CA', genericName: 'Bad', strength: '1 mg', dosageForm: 'TABLET', route: 'ORAL', packSize: 1, unitOfIssue: 'TABLET' })
      .expect(400);
    const drug = await api().get('/api/v1/formulary/drugs/by-hpt/SAMPLE-HPT-0004').set(PHARMACIST);
    await api().patch(`/api/v1/formulary/drugs/${drug.body.id}`).set(PHARMACIST).send({ formularyStatus: 'RESTRICTED', reason: 'DTC decision' }).expect(200);
    const versions = await api().get(`/api/v1/formulary/drugs/${drug.body.id}/versions`).set(PHARMACIST).expect(200);
    expect(versions.body[0]).toMatchObject({ version: 2, reason: 'DTC decision' });
  });

  it('returns graded alerts from the real-time safety check', async () => {
    await api().post('/api/v1/allergies').set(SYSTEM)
      .send({ patientId: 'PAT-2', agentType: 'DRUG_CLASS', atcPrefix: 'J01C', agentText: 'Penicillins', severity: 'SEVERE', verificationStatus: 'CONFIRMED', externalId: 'CT-ALG-1' })
      .expect(201);
    const res = await api().post('/api/v1/safety/check').set(H('PRESCRIBER'))
      .send({
        patientId: 'PAT-2',
        context: { pregnant: true },
        items: [
          { ref: 'a', hptCode: 'SAMPLE-HPT-0003', dose: 5, doseUnit: 'mg', frequencyPerDay: 1, route: 'ORAL' },
          { ref: 'b', hptCode: 'SAMPLE-HPT-0004', dose: 400, doseUnit: 'mg', frequencyPerDay: 3, route: 'ORAL' },
          { ref: 'c', hptCode: 'SAMPLE-HPT-0001', dose: 500, doseUnit: 'mg', frequencyPerDay: 3, route: 'ORAL' },
        ],
      })
      .expect(200);
    const types = res.body.alerts.map((a: any) => `${a.type}:${a.severity}`).sort();
    expect(types).toEqual(['ALLERGY:HARD_STOP', 'FORMULARY:WARNING', 'INTERACTION:WARNING', 'PREGNANCY:HARD_STOP']);
    expect(res.body.canSign).toBe(false);
  });

  it('refuses a signed prescription with an unacknowledged warning, accepts it with an override', async () => {
    const body = prescription({
      patientId: 'PAT-3',
      items: [{ ref: 'L1', hptCode: 'SAMPLE-HPT-0005', atcCode: 'N02BE01', dose: 1500, doseUnit: 'mg', frequency: 'QID', frequencyPerDay: 4, route: 'ORAL', durationDays: 3, quantity: 36 }],
    });
    const refused = await api().post('/api/v1/prescriptions').set(SYSTEM).send(body).expect(422);
    const keys = refused.body.unacknowledged.map((a: any) => a.key);
    expect(keys.length).toBe(2);
    const ok = await api().post('/api/v1/prescriptions').set(SYSTEM)
      .send({ ...body, overrides: keys.map((key: string) => ({ key, reason: 'Short course under supervision' })) })
      .expect(201);
    expect(ok.body.items[0].safetyAlerts.every((a: any) => a.overrideReason)).toBe(true);
  });

  let orderId: string;
  let scheduleId: string;
  let rxBody: ReturnType<typeof prescription>;

  it('receives a signed prescription idempotently and queues it for dispensing', async () => {
    rxBody = prescription();
    const first = await api().post('/api/v1/prescriptions').set(SYSTEM).send(rxBody).expect(201);
    const again = await api().post('/api/v1/prescriptions').set(SYSTEM).send(rxBody).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(first.body.dispenseOrders).toHaveLength(1);
    orderId = first.body.dispenseOrders[0].id;
    scheduleId = first.body.items.find((i: any) => i.hptCode === 'SAMPLE-HPT-0002').refillSchedule.id;
    const queue = await api().get('/api/v1/dispensing/queue?storeId=STORE-1').set(PHARMACIST).expect(200);
    expect(queue.body.map((o: any) => o.id)).toContain(orderId);
  });

  it('verifies, dispenses FEFO via SupplyTrack and bills CliniTrack', async () => {
    await api().post(`/api/v1/dispensing/orders/${orderId}/dispense`).set(PHARMACIST).send({ lines: [{ prescriptionItemId: 'x', quantity: 1 }] }).expect(409);
    await api().post(`/api/v1/dispensing/orders/${orderId}/verify`).set(PHARMACIST).send({}).expect(200);
    const order = await api().get(`/api/v1/dispensing/orders/${orderId}`).set(PHARMACIST);
    const items = order.body.prescription.items;
    const metformin = items.find((i: any) => i.hptCode === 'SAMPLE-HPT-0002');
    const amox = items.find((i: any) => i.hptCode === 'SAMPLE-HPT-0001');

    // Partial first: 21 amoxicillin only.
    const partial = await api().post(`/api/v1/dispensing/orders/${orderId}/dispense`).set(PHARMACIST)
      .send({ lines: [{ prescriptionItemId: amox.id, quantity: 21, counsellingNotes: 'Complete the course' }] })
      .expect(200);
    expect(partial.body.status).toBe('PARTIALLY_DISPENSED');
    expect(partial.body.lines[0].batchNumber).toBe('SOON');

    // The fake always reports 50 in batch SOON, so FEFO takes 50 from SOON and 10 from LATE.
    const done = await api().post(`/api/v1/dispensing/orders/${orderId}/dispense`).set(PHARMACIST)
      .send({ lines: [{ prescriptionItemId: metformin.id, quantity: 60 }] })
      .expect(200);
    expect(done.body.status).toBe('DISPENSED');
    const metLines = done.body.lines.filter((l: any) => l.hptCode === 'SAMPLE-HPT-0002');
    expect(metLines.map((l: any) => [l.batchNumber, Number(l.quantity)])).toEqual([['SOON', 50], ['LATE', 10]]);

    const delivered = await app.get(OutboxService).dispatchDue();
    expect(delivered).toBeGreaterThanOrEqual(4);
    expect(supply.reservations.every((r) => r.committed)).toBe(true);
    const billing = clinitrack.events.filter((e) => e.type === 'dispense.completed');
    expect(billing).toHaveLength(2);
    expect(billing[1]!.payload).toMatchObject({ fillType: 'INITIAL', fillSequence: 0, prescriptionExternalId: rxBody.externalId });
    expect(billing[1]!.payload.lines[0]).toMatchObject({ hptCode: 'SAMPLE-HPT-0002', atcCode: 'A10BA02', unitPrice: 10 });
    const lines = await prisma.dispenseLine.findMany({ where: { dispenseOrderId: orderId } });
    expect(lines.every((l) => l.billingStatus === 'SENT' && l.billingRef)).toBe(true);
  });

  it('starts the refill schedule after the first fill and sends SMS reminders', async () => {
    const s = await api().get(`/api/v1/refills/${scheduleId}`).set(PHARMACIST).expect(200);
    expect(s.body.refillsUsed).toBe(0);
    expect(startOfDay(new Date(s.body.nextDueDate))).toEqual(addDays(startOfDay(new Date()), 30));

    await api().put('/api/v1/patients/PAT-1/contact-preferences').set(SYSTEM).send({ firstName: 'Amina', phone: '0712 345 678', smsOptIn: true, language: 'sw' }).expect(200);
    await api().put('/api/v1/facilities/FAC-1/profile').set(H('ADMINISTRATOR', 'admin')).send({ name: 'Synergy Clinic', phone: '0700 000 000' }).expect(200);

    const refills = app.get(RefillsService);
    const reminderDay = addDays(new Date(s.body.nextDueDate), -3);
    expect((await refills.runDailyReminders(reminderDay)).queued).toBe(1);
    expect((await refills.runDailyReminders(reminderDay)).queued).toBe(1); // re-run: same dedupe key, no second SMS
    await app.get(NotificationsService).sendDue();
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]).toMatchObject({ to: '+254712345678' });
    expect(sms.sent[0]!.body).toContain('Habari Amina');
    expect(sms.sent[0]!.body).toContain('Synergy Clinic');
  });

  it('flags an early refill at verification and bills the refill as a refill', async () => {
    const order = await api().post(`/api/v1/refills/${scheduleId}/request`).set(PHARMACIST).send({}).expect(201);
    await api().post(`/api/v1/refills/${scheduleId}/request`).set(PHARMACIST).send({}).expect(409);
    const blocked = await api().post(`/api/v1/dispensing/orders/${order.body.id}/verify`).set(PHARMACIST).send({}).expect(422);
    const early = blocked.body.unacknowledged.find((a: any) => a.type === 'EARLY_REFILL');
    expect(early).toBeDefined();
    await api().post(`/api/v1/dispensing/orders/${order.body.id}/verify`).set(PHARMACIST)
      .send({ overrides: [{ key: early.key, reason: 'Patient travelling upcountry for a month' }] })
      .expect(200);
    const item = (await prisma.refillSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).prescriptionItemId;
    const done = await api().post(`/api/v1/dispensing/orders/${order.body.id}/dispense`).set(PHARMACIST)
      .send({ lines: [{ prescriptionItemId: item, quantity: 60 }], priceListCode: 'SHA' })
      .expect(200);
    expect(done.body.status).toBe('DISPENSED');
    const s = await prisma.refillSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
    expect(s.refillsUsed).toBe(1);

    await app.get(OutboxService).dispatchDue();
    const refillBill = clinitrack.events.filter((e) => e.type === 'dispense.completed').pop()!;
    expect(refillBill.payload).toMatchObject({ fillType: 'REFILL', fillSequence: 1, priceListCode: 'SHA' });
  });

  it('requires a different witness for controlled drugs', async () => {
    const rx = await api().post('/api/v1/prescriptions').set(SYSTEM)
      .send(prescription({ patientId: 'PAT-4', items: [{ ref: 'L1', hptCode: 'SAMPLE-HPT-0006', atcCode: 'N02AA01', dose: 10, doseUnit: 'mg', frequency: 'Q4H', frequencyPerDay: 6, route: 'ORAL', durationDays: 2, quantity: 12 }] }))
      .expect(201);
    const id = rx.body.dispenseOrders[0].id;
    const itemId = rx.body.items[0].id;
    await api().post(`/api/v1/dispensing/orders/${id}/verify`).set(PHARMACIST).send({}).expect(200);
    await api().post(`/api/v1/dispensing/orders/${id}/dispense`).set(PHARMACIST).send({ lines: [{ prescriptionItemId: itemId, quantity: 12 }] }).expect(400);
    await api().post(`/api/v1/dispensing/orders/${id}/dispense`).set(PHARMACIST).send({ lines: [{ prescriptionItemId: itemId, quantity: 12, witnessedBy: 'u-pharm-1' }] }).expect(400);
    const ok = await api().post(`/api/v1/dispensing/orders/${id}/dispense`).set(PHARMACIST)
      .send({ lines: [{ prescriptionItemId: itemId, quantity: 12, witnessedBy: 'u-pharm-2' }] })
      .expect(200);
    expect(ok.body.lines[0].controlledEntry).toMatchObject({ dispensedBy: 'u-pharm-1', witnessedBy: 'u-pharm-2' });
  });

  it('substitutes only within the substitution group, with a note', async () => {
    const rx = await api().post('/api/v1/prescriptions').set(SYSTEM)
      .send(prescription({ patientId: 'PAT-5', items: [{ ref: 'L1', hptCode: 'SAMPLE-HPT-0007', atcCode: 'C08CA01', dose: 5, doseUnit: 'mg', frequency: 'OD', frequencyPerDay: 1, route: 'ORAL', durationDays: 30, quantity: 30 }] }))
      .expect(201);
    const id = rx.body.dispenseOrders[0].id;
    const itemId = rx.body.items[0].id;
    await api().post(`/api/v1/dispensing/orders/${id}/verify`).set(PHARMACIST).send({}).expect(200);
    await api().post(`/api/v1/dispensing/orders/${id}/dispense`).set(PHARMACIST)
      .send({ lines: [{ prescriptionItemId: itemId, quantity: 30, substituteHptCode: 'SAMPLE-HPT-0005', substitutionNote: 'Out of stock' }] })
      .expect(400);
    const ok = await api().post(`/api/v1/dispensing/orders/${id}/dispense`).set(PHARMACIST)
      .send({ lines: [{ prescriptionItemId: itemId, quantity: 30, substituteHptCode: 'SAMPLE-HPT-0008', substitutionNote: 'Brand A out of stock' }] })
      .expect(200);
    expect(ok.body.lines[0]).toMatchObject({ hptCode: 'SAMPLE-HPT-0008', substitutionNote: 'Brand A out of stock' });
    expect(supply.reservations.filter((r) => r.released)).toHaveLength(0);
  });

  it('restocks returns in SupplyTrack and reverses the bill in CliniTrack', async () => {
    const line = await prisma.dispenseLine.findFirstOrThrow({ where: { dispenseOrderId: orderId, hptCode: 'SAMPLE-HPT-0001' } });
    await api().post(`/api/v1/dispensing/lines/${line.id}/returns`).set(PHARMACIST).send({ quantity: 30, reason: 'Too many' }).expect(400);
    await api().post(`/api/v1/dispensing/lines/${line.id}/returns`).set(PHARMACIST).send({ quantity: 7, reason: 'Course stopped by doctor' }).expect(201);
    await app.get(OutboxService).dispatchDue();
    expect(supply.returns).toHaveLength(1);
    expect(clinitrack.events.some((e) => e.type === 'dispense.returned' && e.payload.quantity === 7)).toBe(true);
  });

  it('reports consumption coded by ATC and HPT', async () => {
    const res = await api().get('/api/v1/reports/consumption?facilityId=FAC-1').set(PHARMACIST).expect(200);
    const met = res.body.find((r: any) => r.hptCode === 'SAMPLE-HPT-0002');
    expect(met).toMatchObject({ atcCode: 'A10BA02', quantity: 120, refillQuantity: 60 });
    const amr = await api().get('/api/v1/reports/antimicrobial-use?facilityId=FAC-1').set(PHARMACIST).expect(200);
    expect(amr.body).toEqual([{ atcClass: 'J01CA', quantity: 14 }]);
  });
});
