// Simulates many pharmacy staff using PharmTrack at once and reports response
// times per call. Read-mostly, like a working day: queues, refills, patients,
// orders, and now and then a report.
//   node apps/api/scripts/load/concurrent.mjs [baseUrl] [users] [seconds]
// Point it only at a load-test API with dev-header sign-in.
const base = process.argv[2] ?? 'http://localhost:3000/api/v1';
const users = Number(process.argv[3] ?? 25);
const seconds = Number(process.argv[4] ?? 60);
const facility = 'FAC-1';
const headers = (u) => ({ 'x-user-id': `load-user-${u}`, 'x-user-roles': 'PHARMACIST', 'x-facility-id': facility });

async function get(u, path) {
  const t = performance.now();
  const r = await fetch(base + path, { headers: headers(u) });
  const body = await r.text();
  return { ms: performance.now() - t, status: r.status, body };
}

// Ids to visit, gathered once.
const seed = async (path) => JSON.parse((await get(0, path)).body);
const overdue = await seed(`/refills?facilityId=${facility}&status=OVERDUE&limit=500`);
const refillIds = overdue.map((r) => r.id);
const patients = [...new Set(overdue.map((r) => r.patientId))];
const now = new Date(new Date().setUTCHours(0, 0, 0, 0) + 86_400_000); // day boundaries, as the web app sends
const iso = (d) => d.toISOString();
const ago = (days) => new Date(now.getTime() - days * 86_400_000);
const reg = await seed(`/reports/controlled-drugs?facilityId=${facility}&from=${iso(ago(7))}&to=${iso(now)}`);
const orderIds = reg.entries.map((e) => e.orderId);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const ACTIONS = [
  [30, 'dispensing queue', () => `/dispensing/queue?storeId=STORE-1&status=PENDING,IN_VERIFICATION`],
  [10, 'refill summary', () => `/refills/summary?facilityId=${facility}`],
  [12, 'refill list page', () => `/refills?facilityId=${facility}&status=OVERDUE&limit=100&offset=${100 * Math.floor(Math.random() * 20)}`],
  [10, 'refill detail', () => `/refills/${pick(refillIds)}`],
  [12, 'order detail', () => `/dispensing/orders/${pick(orderIds)}`],
  [10, 'medication history', () => `/patients/${encodeURIComponent(pick(patients))}/medication-history`],
  [8, 'patient allergies', () => `/patients/${encodeURIComponent(pick(patients))}/allergies`],
  [4, 'report: consumption 30d', () => `/reports/consumption?facilityId=${facility}&from=${iso(ago(30))}&to=${iso(now)}`],
  [2, 'report: adherence 90d', () => `/reports/adherence?facilityId=${facility}&from=${iso(ago(90))}&to=${iso(now)}`],
  [2, 'report: controlled 30d', () => `/reports/controlled-drugs?facilityId=${facility}&from=${iso(ago(30))}&to=${iso(now)}`],
];
if (process.env.NO_REPORTS) ACTIONS.splice(7);
const totalWeight = ACTIONS.reduce((n, a) => n + a[0], 0);
function choose() {
  let r = Math.random() * totalWeight;
  for (const a of ACTIONS) if ((r -= a[0]) < 0) return a;
  return ACTIONS[0];
}

const stats = new Map();
let errors = 0;
const errorSamples = new Set();
const end = Date.now() + seconds * 1000;
async function user(u) {
  while (Date.now() < end) {
    const [, name, path] = choose();
    try {
      const r = await get(u, path());
      if (r.status >= 400) { errors++; errorSamples.add(`${name}: ${r.status} ${r.body.slice(0, 120)}`); }
      (stats.get(name) ?? stats.set(name, []).get(name)).push(r.ms);
    } catch (e) {
      errors++;
      errorSamples.add(`${name}: ${e.message}`);
    }
    // A person reads the screen before the next click: 0.5 to 2 seconds.
    await new Promise((res) => setTimeout(res, 500 + Math.random() * 1500));
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: users }, (_, i) => user(i + 1)));
const elapsed = (Date.now() - started) / 1000;

const pct = (a, p) => Math.round(a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]);
let calls = 0;
const all = [];
console.log(`\n${users} users for ${seconds}s\n\n| Call | Calls | p50 ms | p95 ms | p99 ms |\n|---|---:|---:|---:|---:|`);
for (const [, name] of ACTIONS) {
  const a = (stats.get(name) ?? []).sort((x, y) => x - y);
  calls += a.length;
  all.push(...a);
  if (a.length) console.log(`| ${name} | ${a.length} | ${pct(a, 50)} | ${pct(a, 95)} | ${pct(a, 99)} |`);
}
all.sort((x, y) => x - y);
console.log(`| **All** | ${calls} | ${pct(all, 50)} | ${pct(all, 95)} | ${pct(all, 99)} |`);
console.log(`\n${(calls / elapsed).toFixed(1)} requests/s, ${errors} errors`);
for (const e of [...errorSamples].slice(0, 5)) console.log('  ' + e);
