import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { resolveActor, setSsoVerifier } from './auth';
import { SsoVerifier } from './sso';

describe('SynergyOne SSO (OIDC bearer tokens)', () => {
  let server: Server;
  let issuer: string;
  let sign: (claims: Record<string, unknown>, opts?: { aud?: string; exp?: string | number; iss?: string }) => Promise<string>;
  let foreignSign: (claims: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/.well-known/openid-configuration') return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/certs` }));
      if (req.url === '/certs') return res.end(JSON.stringify({ keys: [jwk] }));
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    sign = (claims, opts = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(opts.iss ?? issuer)
        .setAudience(opts.aud ?? 'pharmtrack')
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? '5m')
        .sign(privateKey);
    foreignSign = (claims) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience('pharmtrack').setExpirationTime('5m').sign(other.privateKey);

    process.env.AUTH_MODE = 'oidc';
    setSsoVerifier(
      new SsoVerifier({
        issuer,
        audience: 'pharmtrack',
        rolesClaim: 'realm_access.roles',
        roleMap: { 'pharm-pharmacist': 'PHARMACIST', 'svc-clinitrack': 'SYSTEM' },
        facilityClaim: 'facility_id',
      }),
    );
  });

  afterAll(() => {
    delete process.env.AUTH_MODE;
    setSsoVerifier(undefined);
    server.close();
  });

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('accepts a valid token and maps roles and facility (keys found by discovery)', async () => {
    const t = await sign({ sub: 'u-1', preferred_username: 'akinyi', realm_access: { roles: ['pharm-pharmacist', 'offline_access'] }, facility_id: 'FAC-9' });
    expect(await resolveActor(bearer(t))).toEqual({ id: 'akinyi', roles: ['PHARMACIST'], facilityId: 'FAC-9' });
  });

  it('maps a service-account token to SYSTEM', async () => {
    const t = await sign({ sub: 'service-account-clinitrack', realm_access: { roles: ['svc-clinitrack'] } });
    expect((await resolveActor(bearer(t)))?.roles).toEqual(['SYSTEM']);
  });

  it('uses the facility header when the token has none', async () => {
    const t = await sign({ sub: 'u-2', realm_access: { roles: ['PRESCRIBER'] } });
    expect((await resolveActor({ ...bearer(t), 'x-facility-id': 'FAC-2' }))?.facilityId).toBe('FAC-2');
  });

  it('rejects wrong audience, wrong issuer, expired, forged and missing tokens', async () => {
    expect(await resolveActor(bearer(await sign({ sub: 'u' }, { aud: 'clinitrack' })))).toBeNull();
    expect(await resolveActor(bearer(await sign({ sub: 'u' }, { iss: 'https://evil.example' })))).toBeNull();
    expect(await resolveActor(bearer(await sign({ sub: 'u' }, { exp: Math.floor(Date.now() / 1000) - 3600 })))).toBeNull();
    expect(await resolveActor(bearer(await foreignSign({ sub: 'u' })))).toBeNull();
    expect(await resolveActor({})).toBeNull();
  });

  it('ignores dev headers in oidc mode', async () => {
    expect(await resolveActor({ 'x-user-id': 'mallory', 'x-user-roles': 'ADMINISTRATOR' })).toBeNull();
  });
});
