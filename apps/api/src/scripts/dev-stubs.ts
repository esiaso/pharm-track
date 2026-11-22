/**
 * Local stand-ins for SupplyTrack (port 5000) and CliniTrack (port 4000), so the
 * whole dispensing flow can be run on one machine. Not for production.
 *
 *   npm run stubs -w apps/api
 */
import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

type Batch = { batchNumber: string; expiryDate: string; quantityAvailable: number };
const stock = new Map<string, Batch[]>(); // key: store|hpt
const reservations = new Map<string, { key: string; lines: { batchNumber: string; quantity: number }[]; state: string }>();
const seen = new Map<string, unknown>(); // idempotency

function batchesFor(store: string, hpt: string): Batch[] {
  const key = `${store}|${hpt}`;
  if (!stock.has(key)) {
    const d = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    stock.set(key, [
      { batchNumber: `${hpt.slice(-4)}-A`, expiryDate: d(120), quantityAvailable: 40 },
      { batchNumber: `${hpt.slice(-4)}-B`, expiryDate: d(500), quantityAvailable: 1000 },
    ]);
  }
  return stock.get(key)!;
}

async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}
function send(res: ServerResponse, status: number, data?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(data === undefined ? '' : JSON.stringify(data));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const key = req.headers['idempotency-key'] as string | undefined;
  if (key && seen.has(key)) return send(res, 200, seen.get(key));
  let m = url.pathname.match(/^\/api\/v1\/stores\/([^/]+)\/items\/([^/]+)\/batches$/);
  if (req.method === 'GET' && m) {
    return send(res, 200, { batches: batchesFor(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)).filter((b) => b.quantityAvailable > 0) });
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/reservations') {
    const b = await body(req);
    const batches = batchesFor(b.storeId, b.hptCode);
    for (const l of b.lines) {
      const batch = batches.find((x) => x.batchNumber === l.batchNumber);
      if (!batch || batch.quantityAvailable < l.quantity) return send(res, 409, { message: `Not enough in ${l.batchNumber}` });
    }
    for (const l of b.lines) batches.find((x) => x.batchNumber === l.batchNumber)!.quantityAvailable -= l.quantity;
    const id = `RES-${randomUUID().slice(0, 8)}`;
    reservations.set(id, { key: `${b.storeId}|${b.hptCode}`, lines: b.lines, state: 'RESERVED' });
    const out = { reservationId: id, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    if (key) seen.set(key, out);
    console.log(`[SupplyTrack] reserved ${id}`, b.lines);
    return send(res, 201, out);
  }
  m = url.pathname.match(/^\/api\/v1\/reservations\/([^/]+)\/(commit|release)$/);
  if (req.method === 'POST' && m) {
    const r = reservations.get(decodeURIComponent(m[1]!));
    if (!r) return send(res, 404, { message: 'No such reservation' });
    if (m[2] === 'release' && r.state === 'RESERVED') {
      const batches = stock.get(r.key)!;
      for (const l of r.lines) batches.find((x) => x.batchNumber === l.batchNumber)!.quantityAvailable += l.quantity;
    }
    r.state = m[2] === 'commit' ? 'COMMITTED' : 'RELEASED';
    console.log(`[SupplyTrack] ${m[2]} ${m[1]}`);
    if (key) seen.set(key, {});
    return send(res, 200, {});
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/stock/returns') {
    const b = await body(req);
    const batch = batchesFor(b.storeId, b.hptCode).find((x) => x.batchNumber === b.batchNumber);
    if (batch) batch.quantityAvailable += b.quantity;
    console.log(`[SupplyTrack] return`, b);
    if (key) seen.set(key, {});
    return send(res, 200, {});
  }
  send(res, 404, { message: 'Not found' });
}).listen(5000, () => console.log('SupplyTrack stub on :5000'));

let billSeq = 0;
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const key = req.headers['idempotency-key'] as string | undefined;
  if (req.method === 'POST' && url.pathname === '/api/v1/integrations/pharmtrack/events') {
    if (key && seen.has(key)) return send(res, 200, seen.get(key));
    const ev = await body(req);
    const out = ev.type === 'dispense.completed' ? { reference: `CT-BILL-${String(++billSeq).padStart(5, '0')}` } : {};
    console.log(`[CliniTrack] ${ev.type}`, ev.type === 'dispense.completed' ? `${ev.payload.lines.length} line(s) → ${out.reference}` : '');
    if (key) seen.set(key, out);
    return send(res, 200, out);
  }
  send(res, 404, { message: 'Not found' });
}).listen(4000, () => console.log('CliniTrack stub on :4000'));
