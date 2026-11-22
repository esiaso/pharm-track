/**
 * Reporting (phase 5) against a real PostgreSQL database. Opt-in like the other
 * e2e suites: runs only with E2E_DATABASE_URL and TRUNCATES that database.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDays } from '../src/domain/dispensing';
import { ClinitrackClient } from '../src/integrations/clinitrack.client';
import { OutboxService } from '../src/integrations/outbox.service';
import { SupplyTrackClient } from '../src/integrations/supplytrack.client';
import { seedSampleData } from '../src/seed/sample-data';
import { contractErrors } from './contracts';

const run = process.env.E2E_DATABASE_URL ? describe : describe.skip;
if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;

const H = (roles: string, user: string) => ({ 'x-user-id': user, 'x-user-roles': roles, 'x-facility-id': 'FAC-1' });
const SYSTEM = H('SYSTEM', 'clinitrack');
const PHARMACIST = H('PHARMACIST', 'u-pharm-1');
const HOUR = 3_600_000;

/** "YYYY-MM" of a date in Nairobi time. */
const monthOf = (d: Date) => new Date(d.getTime() + 3 * HOUR).toISOString().slice(0, 7);

class FakeSupplyTrack extends SupplyTrackClient {
  reports: any[] = [];
  async getBatches() {
    return [{ batchNumber: 'B1', expiryDate: addDays(new Date(), 400), quantityAvailable: 10_000 }];
  }
  async reserve() {
    return { reservationId: `res-${Math.random()}`, expiresAt: addDays(new Date(), 1).toISOString() };
  }
  async commit() {}
  async release() {}
  async returnStock() {}
  async submitStockOutReport(report: unknown) {
    this.reports.push(report);
    return { reference: `ST-SOR-${this.reports.length}` };
  }
}

class FakeClinitrack extends ClinitrackClient {
  events: { type: string; payload: any }[] = [];
  async deliverEvent(type: string, payload: unknown) {
    this.events.push({ type, payload });
    return { reference: type === 'report.submitted' ? `CT-RPT-${this.events.length}` : `CT-${this.events.length}` };
  }
}

run('Reporting end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const supply = new FakeSupplyTrack();
  const clinitrack = new FakeClinitrack();

  beforeAll(async () => {
    prisma = new PrismaClient();
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await seedSampleData(prisma);
    // WHO DDDs for the two products dispensed below.
    await prisma.atcCode.update({ where: { code: 'A10BA02' }, data: { ddd: 2, dddUnit: 'g', dddRoute: 'O' } });
    await prisma.atcCode.update({ where: { code: 'J01CA04' }, data: { ddd: 1.5, dddUnit: 'g', dddRoute: 'O' } });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupplyTrackClient).useValue(supply)
      .overrideProvider(ClinitrackClient).useValue(clinitrack)
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
  const item = (hptCode: string, atcCode: string, quantity: number, route = 'ORAL') => ({ ref: hptCode, hptCode, atcCode, dose: 500, doseUnit: 'mg', frequency: 'BD', frequencyPerDay: 2, route, durationDays: 30, quantity });
  async function prescribeAndDispense(prescriberId: string, items: ReturnType<typeof item>[], signedAt = new Date(), patientId = 'PAT-R1') {
    const rx = await api().post('/api/v1/prescriptions').set(SYSTEM).send({
      externalId: `CT-RX-${Math.random().toString(36).slice(2)}`,
      patientId,
      encounterId: 'ENC-R1',
      prescriberId,
      facilityId: 'FAC-1',
      storeId: 'STORE-1',
      signedAt: signedAt.toISOString(),
      context: { ageMonths: 480, weightKg: 70 },
      items,
    }).expect(201);
    const orderId = rx.body.dispenseOrders[0].id;
    await api().post(`/api/v1/dispensing/orders/${orderId}/verify`).set(PHARMACIST).send({}).expect(200);
    await api().post(`/api/v1/dispensing/orders/${orderId}/dispense`).set(PHARMACIST)
      .send({ lines: rx.body.items.map((i: any) => ({ prescriptionItemId: i.id, quantity: Number(i.quantity) })) })
      .expect(200);
    return rx.body;
  }

  it('reports consumption with WHO DDDs, as JSON or CSV', async () => {
    await prescribeAndDispense('DR-1', [item('SAMPLE-HPT-0002', 'A10BA02', 60), item('SAMPLE-HPT-0001', 'J01CA04', 21)]);
    await app.get(OutboxService).dispatchDue();
    const res = await api().get('/api/v1/reports/consumption?facilityId=FAC-1').set(PHARMACIST).expect(200);
    expect(res.body.map((r: any) => [r.hptCode, r.quantity, r.ddds, r.antimicrobial])).toEqual([
      ['SAMPLE-HPT-0002', 60, 15, false],
      ['SAMPLE-HPT-0001', 21, 7, true],
    ]);
    const am = await api().get('/api/v1/reports/antimicrobial-use?facilityId=FAC-1').set(PHARMACIST).expect(200);
    expect(am.body).toEqual([{ atcClass: 'J01CA', quantity: 21, ddds: 7, productsWithoutDdd: 0 }]);
    const csv = await api().get('/api/v1/reports/consumption?facilityId=FAC-1&format=csv').set(PHARMACIST).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('SAMPLE-HPT-0001,J01CA04,Amoxicillin,500 mg,CAPSULE,21,0,210,7,yes');
  });

  it('computes WHO prescribing indicators per prescriber', async () => {
    await prescribeAndDispense('DR-2', [item('SAMPLE-HPT-0005', 'N02BE01', 20)]);
    const res = await api().get('/api/v1/reports/prescribing?facilityId=FAC-1').set(PHARMACIST).expect(200);
    expect(res.body.facility).toMatchObject({ encounters: 2, items: 3, avgMedicinesPerEncounter: 1.5, pctEncountersWithAntibiotic: 50, pctItemsOnFormulary: 100 });
    expect(res.body.prescribers.map((p: any) => [p.prescriberId, p.encounters, p.pctEncountersWithAntibiotic])).toEqual([['DR-1', 1, 100], ['DR-2', 1, 0]]);
    const csv = await api().get('/api/v1/reports/prescribing?facilityId=FAC-1&format=csv').set(PHARMACIST).expect(200);
    expect(csv.text.split('\r\n')[0]).toBe('prescriberId,encounters,items,avgMedicinesPerEncounter,pctEncountersWithAntibiotic,pctEncountersWithInjection,pctItemsOnFormulary,pctEncountersWithAntimicrobial,overridesPer100Items');
  });

  it('generates a monthly pharmacy return, checks it, and submits it to CliniTrack; a resubmission amends it', async () => {
    const period = monthOf(new Date());
    await api().post('/api/v1/reports/runs').set(PHARMACIST).send({ kind: 'PHARMACY_RETURN', facilityId: 'FAC-1', period: '2026-13' }).expect(400);
    await api().post('/api/v1/reports/runs').set(PHARMACIST).send({ kind: 'PHARMACY_RETURN', facilityId: 'FAC-1', period: '2999-01' }).expect(422);

    // One line that CliniTrack never accepted.
    const line = await prisma.dispenseLine.findFirstOrThrow({ where: { hptCode: 'SAMPLE-HPT-0005' } });
    await prisma.dispenseLine.update({ where: { id: line.id }, data: { billingStatus: 'FAILED' } });

    const v1 = await api().post('/api/v1/reports/runs').set(PHARMACIST).send({ kind: 'PHARMACY_RETURN', facilityId: 'FAC-1', period }).expect(201);
    expect(v1.body).toMatchObject({ status: 'DRAFT', version: 1, summary: { products: 3, ddds: 22, antimicrobialDdds: 7 } });
    expect(v1.body.checks.map((c: any) => c.code)).toEqual(['BILLING_FAILED']);

    // Generating again replaces the draft rather than adding one.
    const again = await api().post('/api/v1/reports/runs').set(PHARMACIST).send({ kind: 'PHARMACY_RETURN', facilityId: 'FAC-1', period }).expect(201);
    expect(again.body.id).toBe(v1.body.id);

    const blocked = await api().post(`/api/v1/reports/runs/${v1.body.id}/submit`).set(PHARMACIST).send({}).expect(422);
    expect(blocked.body.warnings[0].code).toBe('BILLING_FAILED');
    await api().post(`/api/v1/reports/runs/${v1.body.id}/submit`).set(PHARMACIST).send({ acknowledgeWarnings: true }).expect(201);
    await api().post(`/api/v1/reports/runs/${v1.body.id}/submit`).set(PHARMACIST).send({ acknowledgeWarnings: true }).expect(409);
    await api().delete(`/api/v1/reports/runs/${v1.body.id}`).set(PHARMACIST).expect(409);

    await app.get(OutboxService).dispatchDue();
    const sent = clinitrack.events.filter((e) => e.type === 'report.submitted');
    expect(sent).toHaveLength(1);
    expect(contractErrors('report.submitted', sent[0]!.payload)).toEqual([]);
    expect(sent[0]!.payload).toMatchObject({ reportType: 'PHARMACY_RETURN', facilityId: 'FAC-1', period, version: 1, amendsReportId: null });
    expect((await prisma.reportRun.findUniqueOrThrow({ where: { id: v1.body.id } })).externalRef).toBe(`CT-RPT-${clinitrack.events.indexOf(sent[0]!) + 1}`);

    // Billing fixed; an amended return replaces the first.
    await prisma.dispenseLine.update({ where: { id: line.id }, data: { billingStatus: 'SENT' } });
    const v2 = await api().post('/api/v1/reports/runs').set(PHARMACIST).send({ kind: 'PHARMACY_RETURN', facilityId: 'FAC-1', period }).expect(201);
    expect(v2.body).toMatchObject({ version: 2, checks: [] });
    await api().post(`/api/v1/reports/runs/${v2.body.id}/submit`).set(PHARMACIST).send({}).expect(201);
    await app.get(OutboxService).dispatchDue();
    const second = clinitrack.events.filter((e) => e.type === 'report.submitted')[1]!;
    expect(second.payload).toMatchObject({ version: 2, amendsReportId: v1.body.id });
    const runs = await api().get('/api/v1/reports/runs?kind=PHARMACY_RETURN').set(PHARMACIST).expect(200);
    expect(runs.body.map((r: any) => [r.version, r.status])).toEqual([[2, 'SUBMITTED'], [1, 'SUPERSEDED']]);
    const csv = await api().get(`/api/v1/reports/runs/${v2.body.id}/csv`).set(PHARMACIST).expect(200);
    expect(csv.headers['content-disposition']).toContain(`pharmacy-return-FAC-1-${period}-v2.csv`);

    // A draft can be thrown away.
    const v3 = await api().post('/api/v1/reports/runs').set(PHARMACIST).send({ kind: 'PHARMACY_RETURN', facilityId: 'FAC-1', period }).expect(201);
    await api().delete(`/api/v1/reports/runs/${v3.body.id}`).set(PHARMACIST).expect(200);
    await api().post(`/api/v1/reports/runs/${v2.body.id}/submit`).set(H('PRESCRIBER', 'dr')).send({}).expect(403);
  });

  it('tracks stock-outs from SupplyTrack and reports them back to SupplyTrack', async () => {
    const now = Date.now();
    const event = (type: string, at: number) =>
      api().post('/api/v1/integrations/supplytrack/events').set(SYSTEM)
        .send({ type, occurredAt: new Date(at).toISOString(), payload: { storeId: 'STORE-1', hptCode: 'SAMPLE-HPT-0007', quantity: 0 } })
        .expect(200);
    await event('stock.out', now - 48 * HOUR);
    await event('stock.out', now - 40 * HOUR); // repeated: still one episode
    await prescribeAndDispense('DR-1', [item('SAMPLE-HPT-0007', 'C08CA01', 30)], new Date(now - 24 * HOUR), 'PAT-R2');
    await event('stock.restored', now - 12 * HOUR);
    await prescribeAndDispense('DR-1', [item('SAMPLE-HPT-0007', 'C08CA01', 30)], new Date(now - 6 * HOUR), 'PAT-R3');

    const from = new Date(now - 72 * HOUR).toISOString();
    const res = await api().get(`/api/v1/reports/stock-outs?facilityId=FAC-1&from=${from}`).set(PHARMACIST).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ storeId: 'STORE-1', hptCode: 'SAMPLE-HPT-0007', genericName: 'Amlodipine', episodes: 1, daysOut: 1.5, outAtEnd: false, prescriptionItemsAffected: 1 })]);

    const period = monthOf(new Date(now - 48 * HOUR));
    const r = await api().post('/api/v1/reports/runs').set(PHARMACIST).send({ kind: 'STOCK_OUT', facilityId: 'FAC-1', period }).expect(201);
    expect(r.body.summary.itemsOut).toBe(1);
    await api().post(`/api/v1/reports/runs/${r.body.id}/submit`).set(PHARMACIST).send({}).expect(201);
    await app.get(OutboxService).dispatchDue();
    expect(supply.reports).toHaveLength(1);
    expect(contractErrors('supplytrack.stockout.report', supply.reports[0])).toEqual([]);
    expect((await prisma.reportRun.findUniqueOrThrow({ where: { id: r.body.id } })).externalRef).toBe('ST-SOR-1');
  });

  it('queues ADRs for PPB with target dates, exports a batch, and tracks submission and acknowledgement', async () => {
    const serious = await api().post('/api/v1/adrs').set(PHARMACIST)
      .send({ patientId: 'PAT-R1', hptCode: 'SAMPLE-HPT-0001', onsetDate: new Date().toISOString(), description: 'Generalised rash after second dose', seriousness: 'SERIOUS_HOSPITALISATION' })
      .expect(201);
    const mild = await api().post('/api/v1/adrs').set(PHARMACIST)
      .send({ patientId: 'PAT-R1', hptCode: 'SAMPLE-HPT-0002', onsetDate: new Date().toISOString(), description: 'Mild nausea for two days', seriousness: 'NON_SERIOUS' })
      .expect(201);
    await prisma.adverseDrugReaction.update({ where: { id: serious.body.id }, data: { reportedAt: new Date(Date.now() - 10 * 24 * HOUR) } });

    const q = await api().get('/api/v1/reports/adrs/ppb-queue').set(PHARMACIST).expect(200);
    expect(q.body.targets).toEqual({ serious: 7, nonSerious: 30 });
    expect(q.body.counts).toMatchObject({ pending: 2, overdue: 1 });
    expect(q.body.pending.map((a: any) => [a.id, a.overdue])).toEqual([[serious.body.id, true], [mild.body.id, false]]);

    const batch = await api().post('/api/v1/reports/adrs/ppb-batch').set(PHARMACIST).send({ adrIds: [serious.body.id, mild.body.id] }).expect(201);
    expect(batch.body.count).toBe(2);
    expect(batch.body.reports[0]).toMatchObject({ reportType: 'SUSPECTED_ADVERSE_DRUG_REACTION', suspectedDrug: { ppbHptCode: 'SAMPLE-HPT-0001', whoAtcCode: 'J01CA04' } });
    expect((await prisma.adverseDrugReaction.findUniqueOrThrow({ where: { id: mild.body.id } })).ppbReportStatus).toBe('EXPORTED');
    await api().post('/api/v1/reports/adrs/ppb-batch').set(PHARMACIST).send({ adrIds: ['nope'] }).expect(404);

    await api().post(`/api/v1/adrs/${serious.body.id}/ppb-acknowledged`).set(PHARMACIST).send({}).expect(409);
    await api().post(`/api/v1/adrs/${serious.body.id}/ppb-submitted`).set(PHARMACIST).send({ ppbReference: 'PV-2026-001' }).expect(201);
    const ack = await api().post(`/api/v1/adrs/${serious.body.id}/ppb-acknowledged`).set(PHARMACIST).send({ ppbAcknowledgement: 'PPB-CASE-77' }).expect(201);
    expect(ack.body).toMatchObject({ ppbReportStatus: 'ACKNOWLEDGED', ppbReference: 'PV-2026-001 / PPB-CASE-77' });
    const after = await api().get('/api/v1/reports/adrs/ppb-queue').set(PHARMACIST).expect(200);
    expect(after.body.counts).toMatchObject({ pending: 1, overdue: 0, acknowledged: 1 });
  });
});
