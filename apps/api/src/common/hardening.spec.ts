import express from 'express';
import request from 'supertest';
import { apiDocsEnabled, bodyParsers, RateLimiter, rateKey, rateLimitFromEnv, securityHeaders } from './hardening';

function app(limit = 0) {
  const a = express();
  a.use(securityHeaders({ hsts: true }));
  if (limit) a.use(new RateLimiter(limit).middleware());
  for (const p of bodyParsers()) a.use(p);
  a.all('/{*any}', (req, res) => res.json({ size: JSON.stringify(req.body ?? null).length, body: req.body }));
  a.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.status ?? 500).end());
  return a;
}

const big = (kb: number) => ({ text: 'x'.repeat(kb * 1024) });

describe('HTTP hardening', () => {
  it('sets security headers, and no-store on API responses', async () => {
    const r = await request(app()).get('/api/v1/patients/P1');
    expect(r.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
      'strict-transport-security': expect.stringContaining('max-age='),
    });
    expect((await request(app()).get('/health')).headers['cache-control']).toBeUndefined();
  });

  it('accepts up to 1 MB of JSON, and up to 25 MB for content imports', async () => {
    await request(app()).post('/api/v1/prescriptions').send(big(900)).expect(200);
    await request(app()).post('/api/v1/prescriptions').send(big(1100)).expect(413);
    await request(app()).post('/api/v1/content/code-sets/hpt/import').send(big(5000)).expect(200);
  });

  it('parses form bodies such as SMS delivery reports', async () => {
    const r = await request(app()).post('/api/v1/notifications/sms/africastalking/delivery-reports').type('form').send('id=ATX1&status=Success');
    expect(r.body.body).toEqual({ id: 'ATX1', status: 'Success' });
  });

  it('limits each caller per minute and says when to retry', async () => {
    const a = app(3);
    for (let i = 0; i < 3; i++) await request(a).get('/api/v1/x').set('x-user-id', 'pharm-1').expect(200);
    const r = await request(a).get('/api/v1/x').set('x-user-id', 'pharm-1').expect(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    // Another user behind the same proxy address is counted separately.
    await request(a).get('/api/v1/x').set('x-user-id', 'pharm-2').expect(200);
    // Health checks are never limited.
    await request(a).get('/health').expect(200);
  });

  it('opens a new window after a minute', () => {
    const l = new RateLimiter(1, 60_000);
    expect(l.hit('k', 0)).toBe(0);
    expect(l.hit('k', 1_000)).toBe(59);
    expect(l.hit('k', 60_000)).toBe(0);
  });

  it('keys callers by credential, then by address', () => {
    const a = rateKey({ ip: '10.0.0.1', headers: { authorization: 'Bearer abc' } } as never);
    expect(a).toMatch(/^t:/);
    expect(a).not.toContain('abc');
    expect(rateKey({ ip: '10.0.0.1', headers: {} } as never)).toBe('ip:10.0.0.1');
  });

  it('reads settings from the environment', () => {
    expect(rateLimitFromEnv({})).toBe(600);
    expect(rateLimitFromEnv({ RATE_LIMIT_PER_MINUTE: '0' })).toBe(0);
    expect(rateLimitFromEnv({ RATE_LIMIT_PER_MINUTE: 'lots' })).toBe(600);
    expect(apiDocsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: 'production', API_DOCS: 'true' })).toBe(true);
    expect(apiDocsEnabled({})).toBe(true);
  });
});
