/**
 * Retention periods (Kenya Data Protection Act s.39: keep personal data no
 * longer than needed for its purpose). Patient records and logs are kept for
 * 7 years (the facility's policy). Short-lived copies (SMS text, integration
 * payloads, contact details after opt-out) are removed sooner.
 */
export interface RetentionPolicy {
  /** SMS text and phone number on sent or failed messages. */
  smsContentDays: number;
  /** Payloads of delivered integration messages and stored idempotent responses. */
  integrationPayloadDays: number;
  /** Phone number and first name after a patient opts out of SMS. */
  contactAfterOptOutDays: number;
  /** Rows in the patient access log. */
  accessLogDays: number;
  /** Rows in the audit log (who changed what). */
  auditLogDays: number;
  /**
   * All of a patient's PharmTrack records (prescriptions, dispensing, refills,
   * allergies, ADRs, controlled-drug entries, SMS), counted from the patient's
   * last activity, so records of a patient still in care are never removed.
   */
  patientRecordsDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  smsContentDays: 90,
  integrationPayloadDays: 90,
  contactAfterOptOutDays: 30,
  accessLogDays: 7 * 365,
  auditLogDays: 7 * 365,
  patientRecordsDays: 7 * 365,
};

const ENV: Record<keyof RetentionPolicy, string> = {
  smsContentDays: 'RETENTION_SMS_CONTENT_DAYS',
  integrationPayloadDays: 'RETENTION_INTEGRATION_PAYLOAD_DAYS',
  contactAfterOptOutDays: 'RETENTION_CONTACT_AFTER_OPT_OUT_DAYS',
  accessLogDays: 'RETENTION_ACCESS_LOG_DAYS',
  auditLogDays: 'RETENTION_AUDIT_LOG_DAYS',
  patientRecordsDays: 'RETENTION_PATIENT_RECORDS_DAYS',
};

/** Minimums so a typo cannot wipe data the system still needs. */
const MIN: RetentionPolicy = { smsContentDays: 7, integrationPayloadDays: 30, contactAfterOptOutDays: 0, accessLogDays: 365, auditLogDays: 365, patientRecordsDays: 365 };

export function retentionFromEnv(env: Record<string, string | undefined> = process.env): RetentionPolicy {
  const out = { ...DEFAULT_RETENTION };
  for (const k of Object.keys(ENV) as (keyof RetentionPolicy)[]) {
    const raw = env[ENV[k]];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN[k]) throw new Error(`${ENV[k]} must be a whole number of days, at least ${MIN[k]}.`);
    out[k] = n;
  }
  return out;
}

export function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export const REDACTED_SMS = '[removed after retention period]';

/** Most patients whose records one run removes; the rest go in later runs. */
export const MAX_PATIENTS_PER_RUN = 500;
