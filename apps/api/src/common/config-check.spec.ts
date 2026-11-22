import { checkConfig } from './config-check';
import { jobsEnabled } from './jobs';

const PROD_OK = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://x@db/pt',
  AUTH_MODE: 'oidc',
  SSO_ISSUER: 'https://sso.synergyone.example',
  CLINITRACK_BASE_URL: 'https://clinitrack.internal/api/v1',
  CLINITRACK_TOKEN: 't',
  SUPPLYTRACK_BASE_URL: 'https://supplytrack.internal/api/v1',
  SUPPLYTRACK_TOKEN: 't',
  SMS_PROVIDER: 'http',
  SMS_API_URL: 'https://sms.example/send',
  SMS_API_KEY: 'k',
  FHIR_BASE_URL: 'https://pharmtrack.example/api/v1/fhir/R4',
  RETENTION_ENABLED: 'true',
};

describe('startup settings check', () => {
  it('accepts a complete production setup', () => {
    expect(checkConfig(PROD_OK)).toEqual({ errors: [], warnings: [] });
  });

  it('stops production on unsafe or missing settings', () => {
    const r = checkConfig({ ...PROD_OK, AUTH_MODE: 'dev-headers', CLINITRACK_BASE_URL: 'http://localhost:4000/api/v1', SMS_API_KEY: '', RETENTION_ACCESS_LOG_DAYS: '10' });
    expect(r.errors).toEqual([
      expect.stringMatching(/dev-headers is not allowed/),
      expect.stringMatching(/CLINITRACK_BASE_URL must point/),
      'SMS_PROVIDER=http needs SMS_API_KEY.',
      expect.stringMatching(/RETENTION_ACCESS_LOG_DAYS/),
    ]);
  });

  it('warns about settings that work but are risky', () => {
    const r = checkConfig({ ...PROD_OK, SMS_PROVIDER: 'log', SUPPLYTRACK_TOKEN: '', RETENTION_ENABLED: '' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(3);
  });

  it('lets local development run on defaults', () => {
    expect(checkConfig({ DATABASE_URL: 'postgresql://localhost/pt' }).errors).toEqual([]);
  });

  it('runs jobs unless JOBS_ENABLED=false', () => {
    expect(jobsEnabled({})).toBe(true);
    expect(jobsEnabled({ JOBS_ENABLED: 'false' })).toBe(false);
  });
});
