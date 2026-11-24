// Times the calls behind PharmTrack's busy screens and reports against a running API.
//   node apps/api/scripts/load/time-endpoints.mjs [baseUrl] [runs]
// The API must use dev-header sign-in (a load-test database, never production).
const base = process.argv[2] ?? 'http://localhost:3000/api/v1';
const runs = Number(process.argv[3] ?? 5);
const H = { 'x-user-id': 'pharm-load', 'x-user-roles': 'PHARMACIST,ADMINISTRATOR', 'x-facility-id': 'FAC-1', 'content-type': 'application/json' };

async function call(method, path, body) {
  const t = performance.now();
  const r = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return { ms: performance.now() - t, bytes: text.length, json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : null };
}

const iso = (d) => d.toISOString();
const now = new Date();
const days = (n) => new Date(now.getTime() - n * 86_400_000);
const month = `${days(30).getFullYear()}-${String(days(30).getMonth() + 1).padStart(2, '0')}`;

// Ids for detail screens, picked from list calls.
const queue = (await call('GET', '/refills?facilityId=FAC-1&status=OVERDUE')).json;
const refillId = queue[0]?.id;
const patient = queue[0]?.patientId;
const anyOrder = (await call('GET', `/reports/controlled-drugs?facilityId=FAC-1&from=${iso(days(2))}&to=${iso(now)}`)).json.entries[0]?.orderId;

const cases = [
  ['Overview / queue: to verify', 'GET', '/dispensing/queue?storeId=STORE-1&status=PENDING,IN_VERIFICATION'],
  ['Overview / queue: to dispense', 'GET', '/dispensing/queue?storeId=STORE-1&status=VERIFIED,PARTIALLY_DISPENSED'],
  ['Refills due', 'GET', '/refills?facilityId=FAC-1&status=DUE'],
  ['Refills overdue', 'GET', '/refills?facilityId=FAC-1&status=OVERDUE'],
  ['Formulary list', 'GET', '/formulary/drugs?q=&facilityId=FAC-1&limit=100'],
  ['Order detail', 'GET', `/dispensing/orders/${anyOrder}`],
  ['Refill detail', 'GET', `/refills/${refillId}`],
  ['Refill adherence', 'GET', `/refills/${refillId}/adherence`],
  ['Patient medication history', 'GET', `/patients/${encodeURIComponent(patient)}/medication-history`],
  ['Patient allergies', 'GET', `/patients/${encodeURIComponent(patient)}/allergies?includeInactive=true`],
  ['Integrations summary', 'GET', '/integrations/summary'],
  ['Integrations outbox', 'GET', '/integrations/outbox'],
  ['Access log (200)', 'GET', '/privacy/access-log?limit=200'],
  ['Report: consumption 30d', 'GET', `/reports/consumption?facilityId=FAC-1&from=${iso(days(30))}&to=${iso(now)}`],
  ['Report: antimicrobial 30d', 'GET', `/reports/antimicrobial-use?facilityId=FAC-1&from=${iso(days(30))}&to=${iso(now)}`],
  ['Report: refills summary', 'GET', '/reports/refills?facilityId=FAC-1'],
  ['Report: overrides 30d', 'GET', `/reports/safety-overrides?from=${iso(days(30))}&to=${iso(now)}`],
  ['Report: prescribing 30d', 'GET', `/reports/prescribing?facilityId=FAC-1&from=${iso(days(30))}&to=${iso(now)}`],
  ['Report: stock-outs 30d', 'GET', `/reports/stock-outs?facilityId=FAC-1&from=${iso(days(30))}&to=${iso(now)}`],
  ['Report: adherence 90d', 'GET', `/reports/adherence?facilityId=FAC-1&from=${iso(days(90))}&to=${iso(now)}`],
  ['Report: controlled 30d', 'GET', `/reports/controlled-drugs?facilityId=FAC-1&from=${iso(days(30))}&to=${iso(now)}`],
  ['Report: ADR queue', 'GET', '/reports/adrs/ppb-queue'],
  ['Report: runs list', 'GET', '/reports/runs?facilityId=FAC-1'],
  ['Generate monthly return', 'POST', '/reports/runs', { kind: 'PHARMACY_RETURN', facilityId: 'FAC-1', period: month }],
];

const rows = [];
for (const [name, method, path, body] of cases) {
  const times = [];
  let bytes = 0;
  try {
    for (let i = 0; i < runs; i++) {
      const r = await call(method, path, body);
      times.push(r.ms);
      bytes = r.bytes;
    }
    times.sort((a, b) => a - b);
    rows.push({ name, median: Math.round(times[Math.floor(times.length / 2)]), worst: Math.round(times[times.length - 1]), kb: Math.round(bytes / 1024) });
  } catch (e) {
    rows.push({ name, median: NaN, worst: NaN, kb: 0, error: e.message });
  }
}
console.log('| Call | Median ms | Worst ms | Size KB |\n|---|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.name} | ${r.median} | ${r.worst} | ${r.kb} |${r.error ? ' ' + r.error : ''}`);
