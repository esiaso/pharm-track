-- A year of realistic activity for load testing. Run on a throwaway database
-- that has the migrations and the sample data (npm run seed), never on a real one:
--
--   psql "$LOAD_DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/scripts/load/seed-load.sql
--
-- Volumes: FAC-1 is a busy hospital pharmacy (300 prescriptions a day); FAC-2
-- to FAC-5 are smaller (100 a day). About 1.5 items per prescription, a third
-- of items on refills, alerts on 30% of items, audit and access-log rows for
-- every prescription. All ids are prefixed LOAD- / LP- so the rows are easy to spot.

\timing on
SELECT setseed(0.42);

CREATE TEMP TABLE fac (fid text, sid text, perday int);
INSERT INTO fac VALUES ('FAC-1', 'STORE-1', 300), ('FAC-2', 'STORE-2', 100), ('FAC-3', 'STORE-3', 100), ('FAC-4', 'STORE-4', 100), ('FAC-5', 'STORE-5', 100);

CREATE TEMP TABLE d AS
SELECT id, "atcCode", "hptCode", "controlledSchedule" <> 'NONE' AS controlled, row_number() OVER (ORDER BY "hptCode") - 1 AS rn
FROM "Drug";
CREATE TEMP TABLE dcount AS SELECT count(*)::int AS n FROM d;

-- Prescriptions
CREATE TEMP TABLE rx AS
SELECT gen_random_uuid()::text AS id, f.fid, f.sid, day, n,
       'LP-' || f.fid || '-' || floor(random() * f.perday * 40)::int AS patient,
       'dr-' || f.fid || '-' || (n % 25) AS prescriber,
       date_trunc('day', now()) - make_interval(days => day) + make_interval(mins => 420 + floor(random() * 660)::int) AS at
FROM fac f, generate_series(1, 365) AS day, LATERAL generate_series(1, f.perday) AS n;

INSERT INTO "Prescription" (id, "externalId", "patientId", "encounterId", "prescriberId", "facilityId", "storeId", status, "signedAt", "receivedAt")
SELECT id, 'LOAD-' || fid || '-' || day || '-' || n, patient, 'LE-' || fid || '-' || day || '-' || n, prescriber, fid, sid, 'COMPLETED', at, at FROM rx;

-- Items: one per prescription, a second for half of them
CREATE TEMP TABLE item AS
SELECT gen_random_uuid()::text AS id, rx.id AS rx_id, rx.fid, rx.sid, rx.patient, rx.at, k,
       floor(random() * (SELECT n FROM dcount))::int AS drn,
       random() < 0.33 AS refills
FROM rx, LATERAL generate_series(1, CASE WHEN random() < 0.5 THEN 2 ELSE 1 END) AS k;

INSERT INTO "PrescriptionItem" (id, "prescriptionId", "drugId", "atcCode", "hptCode", dose, "doseUnit", frequency, "frequencyPerDay", route, "durationDays", quantity, "refillsAuthorised", "quantityDispensed")
SELECT i.id, i.rx_id, d.id, d."atcCode", d."hptCode", 1, 'tablet', 'BD', 2, 'ORAL', 30, 60, CASE WHEN i.refills THEN 2 ELSE 0 END, 60
FROM item i JOIN d ON d.rn = i.drn;

-- Initial fills: one order per prescription, one line per item
CREATE TEMP TABLE ord AS SELECT gen_random_uuid()::text AS id, rx.id AS rx_id, rx.fid, rx.day, rx.n FROM rx;
INSERT INTO "DispenseOrder" (id, "prescriptionId", kind, "fillSequence", "facilityId", "storeId", priority, status, "verifiedBy", "verifiedAt", "createdAt", "updatedAt")
SELECT o.id, rx.id, 'INITIAL', 0, rx.fid, rx.sid, 'ROUTINE', 'DISPENSED', 'pharm-' || rx.fid, rx.at + interval '10 min', rx.at, rx.at + interval '20 min'
FROM ord o JOIN rx ON rx.id = o.rx_id;

CREATE TEMP TABLE line AS
SELECT gen_random_uuid()::text AS id, o.id AS order_id, i.id AS item_id, i.drn, i.fid, i.patient, i.at + interval '20 min' AS at, 0 AS seq
FROM item i JOIN ord o ON o.rx_id = i.rx_id;

-- Refills: schedules for items with refills; refill fills about 30 and 60
-- days later (some late, some never collected), once that date has passed.
CREATE TEMP TABLE sched AS
SELECT gen_random_uuid()::text AS sched_id, i.id AS item_id, i.rx_id, i.fid, i.sid, i.patient, i.at, i.drn,
       floor(random() * 12)::int - 2 AS late1, floor(random() * 12)::int - 2 AS late2,
       random() < 0.15 AS lapsed, random() < 0.10 AS stops
FROM item i WHERE refills;

CREATE TEMP TABLE refill_fill AS
SELECT gen_random_uuid()::text AS order_id, gen_random_uuid()::text AS line_id, s.sched_id, s.item_id, s.rx_id, s.fid, s.sid, s.patient, s.drn, seq,
       s.at + make_interval(days => 30 * seq + s.late1 + CASE WHEN seq = 2 THEN s.late2 ELSE 0 END) AS at
FROM sched s CROSS JOIN generate_series(1, 2) AS seq
WHERE NOT s.lapsed AND NOT (seq = 2 AND s.stops)
  AND s.at + make_interval(days => 30 * seq + s.late1 + CASE WHEN seq = 2 THEN s.late2 ELSE 0 END) < now();

INSERT INTO "RefillSchedule" (id, "prescriptionItemId", "patientId", "facilityId", "refillsAuthorised", "refillsUsed", "lastDispensedAt", "nextDueDate", "earliestRefillDate", "graceDays", "expiresAt", status, "createdAt", "updatedAt")
SELECT s.sched_id, s.item_id, s.patient, s.fid, 2, coalesce(f.used, 0), coalesce(f.last, s.at + interval '20 min'),
       coalesce(f.last, s.at) + interval '30 days', coalesce(f.last, s.at) + interval '27 days', 3, s.at + interval '180 days',
       (CASE
          WHEN coalesce(f.used, 0) = 2 THEN 'COMPLETED'
          WHEN s.at + interval '180 days' < now() THEN 'EXPIRED'
          WHEN coalesce(f.last, s.at) + interval '33 days' < now() THEN 'OVERDUE'
          WHEN coalesce(f.last, s.at) + interval '30 days' < now() THEN 'DUE'
          ELSE 'UPCOMING' END)::"RefillStatus",
       s.at, now()
FROM sched s LEFT JOIN (SELECT sched_id, count(*)::int AS used, max(at) AS last FROM refill_fill GROUP BY sched_id) f USING (sched_id);

INSERT INTO "DispenseOrder" (id, "prescriptionId", kind, "fillSequence", "facilityId", "storeId", "refillScheduleId", priority, status, "verifiedBy", "verifiedAt", "createdAt", "updatedAt")
SELECT order_id, rx_id, 'REFILL', seq, fid, sid, sched_id, 'ROUTINE', 'DISPENSED', 'pharm-' || fid, at - interval '10 min', at - interval '20 min', at
FROM refill_fill;

-- Lines: initial fills plus refill fills
INSERT INTO line SELECT line_id, order_id, item_id, drn, fid, patient, at, seq FROM refill_fill;

INSERT INTO "DispenseLine" (id, "dispenseOrderId", "prescriptionItemId", "drugId", "atcCode", "hptCode", quantity, "batchNumber", "expiryDate", "supplyReservationId", "unitPrice", "dispensedBy", "dispensedAt", "billingRef", "billingStatus")
SELECT l.id, l.order_id, l.item_id, d.id, d."atcCode", d."hptCode", 60, 'B' || to_char(l.at, 'YYMM') || '-' || d.rn, l.at + interval '400 days',
       'RES-' || l.id, 10, 'pharm-' || l.fid, l.at, 'BILL-' || l.id, 'BILLED'
FROM line l JOIN d ON d.rn = l.drn;

INSERT INTO "ControlledDrugRegisterEntry" (id, "dispenseLineId", "drugId", "patientId", quantity, "dispensedBy", "witnessedBy", "recordedAt")
SELECT gen_random_uuid(), l.id, d.id, l.patient, 60, 'pharm-' || l.fid, 'pharm2-' || l.fid, l.at
FROM line l JOIN d ON d.rn = l.drn WHERE d.controlled;

-- Safety alerts on 30% of items, most overridden at prescribing
INSERT INTO "SafetyAlert" (id, "prescriptionItemId", stage, "alertKey", type, severity, message, "overriddenBy", "overrideReason", "raisedAt")
SELECT gen_random_uuid(), i.id, 'PRESCRIBING', 'INTERACTION:LOAD-' || i.id, 'INTERACTION', 'WARNING', 'Load-test interaction warning',
       CASE WHEN random() < 0.9 THEN 'dr-load' END, CASE WHEN random() < 0.9 THEN 'Benefit outweighs risk, monitoring' END, i.at
FROM item i WHERE random() < 0.3;

-- Refill SMS: a reminder and a due notice for each schedule
INSERT INTO "Notification" (id, "patientId", "refillScheduleId", purpose, "toAddress", body, status, "dedupeKey", attempts, "scheduledFor", "sentAt", "deliveredAt", "createdAt")
SELECT gen_random_uuid(), s.patient, s.sched_id, p.purpose::"NotificationPurpose", '+2547' || lpad((abs(hashtext(s.patient)) % 100000000)::text, 8, '0'),
       'Load-test reminder', 'DELIVERED', p.purpose || ':' || s.sched_id, 1, s.at + p.off, s.at + p.off, s.at + p.off + interval '1 min', s.at + p.off
FROM sched s CROSS JOIN (VALUES ('REFILL_REMINDER', interval '27 days'), ('REFILL_DUE', interval '30 days')) AS p(purpose, off)
WHERE s.at + p.off < now();

-- Delivered outbox messages: billing for each line, stock commit for each order
INSERT INTO "OutboxEvent" (id, type, destination, "idempotencyKey", payload, status, attempts, "nextAttemptAt", "createdAt", "deliveredAt")
SELECT gen_random_uuid(), 'dispense.completed', 'CLINITRACK', 'LOAD-BILL-' || l.id, jsonb_build_object('lineId', l.id), 'DELIVERED', 1, l.at, l.at, l.at + interval '5 s'
FROM line l;

-- Audit (verify, dispense, label print) and patient access log (queue, order, history, allergies)
INSERT INTO "AuditLog" (id, "actorId", "actorRole", action, "entityType", "entityId", "at")
SELECT gen_random_uuid(), 'pharm-' || rx.fid, 'PHARMACIST', a.action, 'DispenseOrder', o.id, rx.at + a.off
FROM rx JOIN ord o ON o.rx_id = rx.id
CROSS JOIN (VALUES ('dispense.verify', interval '10 min'), ('dispense.complete', interval '20 min'), ('label.print', interval '21 min')) AS a(action, off);

INSERT INTO "PatientAccessLog" (id, "patientId", "actorId", "actorRole", "facilityId", action, path, "at")
SELECT gen_random_uuid(), rx.patient, 'pharm-' || rx.fid, 'PHARMACIST', rx.fid, a.action, '/api/v1/load', rx.at + a.off
FROM rx CROSS JOIN (VALUES ('dispense-order.read', interval '5 min'), ('allergies.list', interval '6 min'), ('medication-history.read', interval '7 min'), ('dispense-order.read', interval '15 min')) AS a(action, off);

-- Facility profiles so screens behave as in production
INSERT INTO "FacilityProfile" ("facilityId", name, phone, "updatedAt")
SELECT fid, 'Load facility ' || fid, '0700 000 000', now() FROM fac
ON CONFLICT ("facilityId") DO NOTHING;

ANALYZE "Prescription", "PrescriptionItem", "DispenseOrder", "DispenseLine", "SafetyAlert", "RefillSchedule", "ControlledDrugRegisterEntry", "Notification", "OutboxEvent", "AuditLog", "PatientAccessLog";

SELECT 'prescriptions' AS what, count(*) FROM "Prescription" UNION ALL
SELECT 'items', count(*) FROM "PrescriptionItem" UNION ALL
SELECT 'orders', count(*) FROM "DispenseOrder" UNION ALL
SELECT 'lines', count(*) FROM "DispenseLine" UNION ALL
SELECT 'alerts', count(*) FROM "SafetyAlert" UNION ALL
SELECT 'refill schedules', count(*) FROM "RefillSchedule" UNION ALL
SELECT 'controlled entries', count(*) FROM "ControlledDrugRegisterEntry" UNION ALL
SELECT 'notifications', count(*) FROM "Notification" UNION ALL
SELECT 'outbox', count(*) FROM "OutboxEvent" UNION ALL
SELECT 'audit', count(*) FROM "AuditLog" UNION ALL
SELECT 'access log', count(*) FROM "PatientAccessLog";
