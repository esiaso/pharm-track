import { DEFAULT_RETENTION, cutoff, retentionFromEnv } from './retention';

describe('retention policy', () => {
  it('uses defaults and reads overrides', () => {
    expect(retentionFromEnv({})).toEqual(DEFAULT_RETENTION);
    expect(retentionFromEnv({ RETENTION_SMS_CONTENT_DAYS: '30' }).smsContentDays).toBe(30);
  });
  it('refuses values below the minimum or not whole days', () => {
    expect(() => retentionFromEnv({ RETENTION_ACCESS_LOG_DAYS: '30' })).toThrow(/at least 365/);
    expect(() => retentionFromEnv({ RETENTION_SMS_CONTENT_DAYS: '7.5' })).toThrow();
  });
  it('computes cutoffs', () => {
    expect(cutoff(new Date('2026-11-22T00:00:00Z'), 30).toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });
});
