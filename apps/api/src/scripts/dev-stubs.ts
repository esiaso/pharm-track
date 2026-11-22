/**
 * Local stand-ins for SupplyTrack (port 5000), CliniTrack (port 4000) and a
 * SynergyOne-style OpenID Connect sign-in server (port 4400), so the whole flow
 * can be run on one machine. Not for production.
 *
 *   npm run stubs -w apps/api
 */
import { createHash, randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
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

// ── Dev SSO (OIDC) on :4400 ─────────────────────────────────────────────────
// API:  AUTH_MODE=oidc SSO_ISSUER=http://localhost:4400 SSO_AUDIENCE=pharmtrack
// Web:  NEXT_PUBLIC_SSO_AUTHORITY=http://localhost:4400 NEXT_PUBLIC_SSO_CLIENT_ID=pharmtrack-web
const SSO = 'http://localhost:4400';
void (async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'dev', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { user: string; roles: string[]; facility: string; challenge: string; clientId: string; nonce?: string }>();
  const page = (html: string) => `<!doctype html><meta name=viewport content="width=device-width"><body style="font:15px system-ui;max-width:380px;margin:48px auto;padding:0 16px">${html}</body>`;
  const sign = (claims: Record<string, unknown>, aud: string) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'dev' }).setIssuer(SSO).setAudience(aud).setIssuedAt().setExpirationTime('1h').sign(privateKey);

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', SSO);
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, {
        issuer: SSO,
        authorization_endpoint: `${SSO}/authorize`,
        token_endpoint: `${SSO}/token`,
        jwks_uri: `${SSO}/jwks`,
        end_session_endpoint: `${SSO}/logout`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['RS256'],
        subject_types_supported: ['public'],
      });
    }
    if (url.pathname === '/jwks') return send(res, 200, { keys: [jwk] });
    if (url.pathname === '/authorize' && req.method === 'GET') {
      const q = url.searchParams;
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page(`<h2>SynergyOne (dev)</h2><form method=post>
        ${['redirect_uri', 'state', 'code_challenge', 'client_id', 'nonce'].map((k) => `<input type=hidden name=${k} value="${(q.get(k) ?? '').replace(/"/g, '&quot;')}">`).join('')}
        <p><label>User<br><input name=user value=akinyi.pharm></label></p>
        <p><label>Role<br><select name=role>${['PHARMACIST', 'PHARMACY_TECHNICIAN', 'PRESCRIBER', 'STORE_KEEPER', 'ADMINISTRATOR'].map((r) => `<option>${r}</option>`).join('')}</select></label></p>
        <p><label>Facility<br><input name=facility value=FAC-1></label></p>
        <button>Sign in</button></form>`));
    }
    if (url.pathname === '/authorize' && req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      const f = new URLSearchParams(raw);
      const code = randomUUID();
      codes.set(code, { user: f.get('user')!, roles: [f.get('role')!], facility: f.get('facility')!, challenge: f.get('code_challenge')!, clientId: f.get('client_id')!, nonce: f.get('nonce') || undefined });
      const back = new URL(f.get('redirect_uri')!);
      back.searchParams.set('code', code);
      if (f.get('state')) back.searchParams.set('state', f.get('state')!);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      const f = new URLSearchParams(raw);
      if (f.get('grant_type') === 'client_credentials') {
        // Service accounts for CliniTrack / SupplyTrack (dev only: no secret check).
        const client = f.get('client_id') ?? 'service';
        return send(res, 200, { token_type: 'Bearer', expires_in: 3600, access_token: await sign({ sub: `service-account-${client}`, preferred_username: client, roles: ['SYSTEM'] }, 'pharmtrack') });
      }
      const c = codes.get(f.get('code') ?? '');
      codes.delete(f.get('code') ?? '');
      const verifier = f.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!c || challenge !== c.challenge) return send(res, 400, { error: 'invalid_grant' });
      const claims = { sub: c.user, preferred_username: c.user, roles: c.roles, facility_id: c.facility };
      return send(res, 200, {
        token_type: 'Bearer',
        expires_in: 3600,
        access_token: await sign(claims, 'pharmtrack'),
        id_token: await sign({ ...claims, nonce: c.nonce }, c.clientId),
        scope: 'openid profile',
      });
    }
    if (url.pathname === '/logout') {
      res.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') ?? 'http://localhost:3001' });
      return res.end();
    }
    send(res, 404, { error: 'not_found' });
  }).listen(4400, () => console.log('Dev SSO (OIDC) on :4400'));
})();
