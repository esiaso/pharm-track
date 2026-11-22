'use client';

import type { ReactNode } from 'react';
import { label } from '../lib/format';

const TONE: Record<string, string> = {
  HARD_STOP: 'danger', WARNING: 'warn', INFO: 'info',
  STAT: 'danger', URGENT: 'warn', ROUTINE: 'neutral',
  PENDING: 'neutral', IN_VERIFICATION: 'info', VERIFIED: 'info', PARTIALLY_DISPENSED: 'warn',
  DISPENSED: 'ok', CANCELLED: 'neutral', RETURNED: 'neutral',
  UPCOMING: 'neutral', DUE: 'warn', OVERDUE: 'danger', COMPLETED: 'ok', EXPIRED: 'neutral',
  CONTROLLED: 'warn', ACTIVE: 'ok', RESTRICTED: 'warn', NON_FORMULARY: 'warn', DISCONTINUED: 'danger',
  QUEUED: 'info', SENT: 'ok', DELIVERED: 'ok', FAILED: 'danger', SKIPPED_NO_CONSENT: 'neutral',
  BILLED: 'ok', REVERSED: 'neutral', CONFIRMED: 'danger', UNCONFIRMED: 'warn', REFUTED: 'neutral',
  SEVERE: 'danger', LIFE_THREATENING: 'danger', MODERATE: 'warn', MILD: 'info',
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className={`badge ${TONE[value] ?? 'neutral'}`}>{label(value)}</span>;
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="error" role="alert">{error}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Field({ label: l, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{l}</span>{children}</label>;
}

export function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="dl">
      {items.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v ?? '–'}</dd></div>
      ))}
    </dl>
  );
}
