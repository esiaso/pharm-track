import { ssoConfigFromEnv } from './sso';
import { labelSizeFromEnv, printersFromEnv } from '../domain/labels';
import { retentionFromEnv } from '../domain/retention';

export type ConfigReport = { errors: string[]; warnings: string[] };

const isLocal = (url: string | undefined) => !url || /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(url);

/**
 * Checks settings before the API starts. In production (NODE_ENV=production)
 * errors stop the process; elsewhere they are only reported, so local
 * development keeps working with the defaults.
 */
export function checkConfig(env: Record<string, string | undefined> = process.env): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = env.NODE_ENV === 'production';

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is not set.');
  const auth = env.AUTH_MODE ?? 'dev-headers';
  if (auth === 'oidc') {
    try {
      ssoConfigFromEnv(env);
    } catch (e) {
      errors.push((e as Error).message);
    }
  } else if (auth !== 'dev-headers') errors.push(`AUTH_MODE must be oidc or dev-headers, not "${auth}".`);
  else if (prod) errors.push('AUTH_MODE=dev-headers is not allowed in production. Set AUTH_MODE=oidc and the SSO_* settings.');

  for (const [name, url, token] of [
    ['CLINITRACK', env.CLINITRACK_BASE_URL, env.CLINITRACK_TOKEN],
    ['SUPPLYTRACK', env.SUPPLYTRACK_BASE_URL, env.SUPPLYTRACK_TOKEN],
  ] as const) {
    if (prod && isLocal(url)) errors.push(`${name}_BASE_URL must point at the ${name === 'CLINITRACK' ? 'CliniTrack' : 'SupplyTrack'} service in production.`);
    if (prod && url && !url.startsWith('https://')) warnings.push(`${name}_BASE_URL is not https; patient data would travel unencrypted unless the network is private.`);
    if (prod && !token) warnings.push(`${name}_TOKEN is not set; calls to ${name === 'CLINITRACK' ? 'CliniTrack' : 'SupplyTrack'} carry no credentials.`);
  }

  const sms = env.SMS_PROVIDER ?? 'log';
  if (sms === 'http') {
    if (!env.SMS_API_URL) errors.push('SMS_PROVIDER=http needs SMS_API_URL.');
    if (!env.SMS_API_KEY) errors.push('SMS_PROVIDER=http needs SMS_API_KEY.');
  } else if (sms === 'africastalking') {
    if (!env.AFRICASTALKING_USERNAME) errors.push('SMS_PROVIDER=africastalking needs AFRICASTALKING_USERNAME.');
    if (!env.SMS_API_KEY) errors.push('SMS_PROVIDER=africastalking needs SMS_API_KEY (the Africa\'s Talking API key).');
    if (prod && env.AFRICASTALKING_USERNAME === 'sandbox') warnings.push('AFRICASTALKING_USERNAME=sandbox: SMS go to the Africa\'s Talking simulator, not to patients.');
    if (!env.SMS_SENDER_ID) warnings.push('SMS_SENDER_ID is not set: Africa\'s Talking sends from its shared short code.');
    if (!env.SMS_WEBHOOK_SECRET || env.SMS_WEBHOOK_SECRET.length < 16) warnings.push('SMS_WEBHOOK_SECRET (16+ characters) is not set: delivery reports from Africa\'s Talking are refused.');
  } else if (sms === 'log') {
    if (prod) warnings.push('SMS_PROVIDER=log: patient SMS are written to the log, not sent.');
  } else errors.push(`SMS_PROVIDER must be africastalking, http or log, not "${sms}".`);

  for (const check of [retentionFromEnv, labelSizeFromEnv, printersFromEnv]) {
    try {
      check(env);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  for (const k of ['ADR_SERIOUS_DAYS', 'ADR_NON_SERIOUS_DAYS']) {
    const v = env[k];
    if (v !== undefined && v !== '' && !(Number.isInteger(Number(v)) && Number(v) > 0)) errors.push(`${k} must be a positive whole number of days.`);
  }
  if (env.HPT_CODE_PATTERN) {
    try {
      new RegExp(env.HPT_CODE_PATTERN);
    } catch {
      errors.push('HPT_CODE_PATTERN is not a valid regular expression.');
    }
  }
  if (prod && !env.FHIR_BASE_URL) warnings.push('FHIR_BASE_URL is not set; FHIR links are built from the request host, which may be an internal name behind a proxy.');
  if (prod && env.RETENTION_ENABLED !== 'true') warnings.push('RETENTION_ENABLED is not true; the 7-year retention job will not run.');
  return { errors, warnings };
}
