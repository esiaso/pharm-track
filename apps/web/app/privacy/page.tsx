'use client';

import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Field } from '../../components/ui';
import { api, download, useApi } from '../../lib/api';
import { dateTime, label } from '../../lib/format';

type Tab = 'access' | 'requests' | 'retention';
const TABS: [Tab, string][] = [['access', 'Access log'], ['requests', 'Patient requests'], ['retention', 'Retention']];

type AccessRow = { id: string; patientId: string; actorId: string; actorRole: string; facilityId: string | null; action: string; purpose: string | null; path: string; at: string };
type Counts = { smsContent: number; outboxPayloads: number; idempotencyRecords: number; contactDetails: number; accessLogRows: number };
type Retention = {
  enabled: boolean;
  policy: { smsContentDays: number; integrationPayloadDays: number; contactAfterOptOutDays: number; accessLogDays: number };
  due: Counts;
  lastRun: null | { id: string; startedAt: string; trigger: string; actorId: string | null; results: { removed: Counts } };
};

const ACTION_LABEL: Record<string, string> = {
  'allergies.read': 'Allergies',
  'adrs.list': 'ADR list',
  'adrs.ppb-export': 'ADR PPB form',
  'adrs.ppb-queue': 'ADR queue for PPB',
  'adrs.ppb-batch': 'ADR batch for PPB',
  'prescription.read': 'Prescription',
  'medication-history.read': 'Medication history',
  'dispense-order.read': 'Dispense order',
  'controlled-register.read': 'Controlled drug register',
  'refill.read': 'Refill',
  'refill.adherence': 'Refill adherence',
  'notifications.list': 'SMS messages',
  'contact-preferences.read': 'SMS contact details',
  'patient.export': 'Full data export',
  'fhir.search': 'FHIR search',
  'fhir.read': 'FHIR read',
};

export default function PrivacyPage() {
  const [tab, setTab] = useState<Tab>('access');
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.some(([t]) => t === h)) setTab(h);
  }, []);
  return (
    <section className="stack">
      <h1>Data protection</h1>
      <p className="muted small">Kenya Data Protection Act: who has seen patient data, patient requests, and how long data is kept.</p>
      <div className="tabs" role="tablist">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); history.replaceState(null, '', `#${t}`); }}>{l}</button>
        ))}
      </div>
      {tab === 'access' && <AccessTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'retention' && <RetentionTab />}
    </section>
  );
}

// ── Access log ────────────────────────────────────────────────────────────

function AccessTab() {
  const [patientId, setPatientId] = useState('');
  const [actorId, setActorId] = useState('');
  const [query, setQuery] = useState('');
  const { data, error } = useApi<{ total: number; rows: AccessRow[] }>(`/privacy/access-log?limit=200${query}`);
  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (patientId.trim()) q.set('patientId', patientId.trim());
    if (actorId.trim()) q.set('actorId', actorId.trim());
    setQuery(q.toString() ? `&${q}` : '');
  }
  return (
    <div className="stack">
      <form className="row" onSubmit={search} style={{ alignItems: 'flex-end' }}>
        <Field label="Patient id"><input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="e.g. PAT-1" /></Field>
        <Field label="User"><input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="user or service id" /></Field>
        <button className="primary" type="submit">Search</button>
      </form>
      <ErrorBox error={error} />
      {data && (
        <>
          <p className="small muted">{data.total > data.rows.length ? `Latest ${data.rows.length} of ${data.total.toLocaleString()} reads.` : `${data.total.toLocaleString()} reads.`}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Patient</th><th>Who</th><th>What</th><th>Purpose</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.at)}</td>
                    <td className="mono">{r.patientId === '*' ? 'more patients (list cut off)' : r.patientId}</td>
                    <td>{r.actorId} <span className="small muted">{label(r.actorRole)}{r.facilityId ? `, ${r.facilityId}` : ''}</span></td>
                    <td title={r.path}>{ACTION_LABEL[r.action.replace(/\.truncated$/, '')] ?? r.action}</td>
                    <td>{r.purpose ? label(r.purpose) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <Empty>No reads recorded{query ? ' for this search' : ''}.</Empty>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Patient requests ──────────────────────────────────────────────────────

function RequestsTab() {
  const [patientId, setPatientId] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = patientId.trim();

  async function exportData() {
    setError(null);
    setDone(null);
    try {
      await download(`/privacy/patients/${encodeURIComponent(id)}/export`, `pharmtrack-patient-${id}.json`);
      setDone(`Downloaded everything PharmTrack holds for ${id}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function erase() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ stoppedMessages: number }>(`/privacy/patients/${encodeURIComponent(id)}/erase-contact`, { body: { reason } });
      setDone(`Removed the phone number and first name for ${id}. SMS is off${r.stoppedMessages ? ` and ${r.stoppedMessages} waiting message${r.stoppedMessages === 1 ? ' was' : 's were'} stopped` : ''}. Ask CliniTrack to remove them too, or they will be sent again.`);
      setConfirming(false);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Field label="Patient id (CliniTrack)"><input value={patientId} onChange={(e) => { setPatientId(e.target.value); setDone(null); setConfirming(false); }} placeholder="e.g. PAT-1" /></Field>
      <ErrorBox error={error} />
      {done && <div className="alert">{done}</div>}
      <div className="card stack">
        <h3>Access request</h3>
        <p className="small">Downloads everything PharmTrack holds about the patient as JSON: allergies, ADRs, prescriptions and dispensing, refills, SMS messages, controlled drug register entries and the access log. Demographics and clinical notes come from CliniTrack.</p>
        <div><button disabled={!id} onClick={() => void exportData()}>Download patient data</button></div>
      </div>
      <div className="card stack">
        <h3>Remove SMS contact details</h3>
        <p className="small">Removes the phone number and first name and stops SMS. Clinical records stay: they are needed for the patient&apos;s care and must be kept by law.</p>
        {!confirming ? (
          <div><button className="danger" disabled={!id} onClick={() => setConfirming(true)}>Remove contact details</button></div>
        ) : (
          <>
            <Field label="Reason (recorded in the audit log)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient asked at the counter" /></Field>
            <div className="row">
              <button className="danger" disabled={busy || reason.trim().length < 5} onClick={() => void erase()}>Remove for {id}</button>
              <button onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Retention ─────────────────────────────────────────────────────────────

const RULES: { key: keyof Counts; days: keyof Retention['policy']; what: string }[] = [
  { key: 'smsContent', days: 'smsContentDays', what: 'SMS text and phone number on sent messages' },
  { key: 'outboxPayloads', days: 'integrationPayloadDays', what: 'Content of messages delivered to CliniTrack and SupplyTrack' },
  { key: 'idempotencyRecords', days: 'integrationPayloadDays', what: 'Stored replies kept for retried requests' },
  { key: 'contactDetails', days: 'contactAfterOptOutDays', what: 'Phone number and first name after SMS opt-out' },
  { key: 'accessLogRows', days: 'accessLogDays', what: 'Access log entries' },
];

function RetentionTab() {
  const { data, error: loadError, reload } = useApi<Retention>('/privacy/retention');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Counts | null>(null);
  const totalDue = data ? Object.values(data.due).reduce((s, n) => s + n, 0) : 0;

  async function runNow() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ removed: Counts }>('/privacy/retention/run', { body: {} });
      setResult(r.removed);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <><ErrorBox error={loadError} />{!loadError && <p className="muted">Loading…</p>}</>;
  return (
    <div className="stack">
      <p className="small">
        {data.enabled ? 'Runs every night at 01:30.' : 'The nightly run is off (RETENTION_ENABLED). You can run it here.'} Prescriptions, dispensing, allergies, ADRs and the controlled drug register are never removed automatically.
        {data.lastRun && ` Last run ${dateTime(data.lastRun.startedAt)} (${data.lastRun.trigger === 'CRON' ? 'nightly' : `by ${data.lastRun.actorId}`}).`}
      </p>
      <ErrorBox error={error} />
      {result && <div className="alert">Done. {Object.values(result).reduce((s, n) => s + n, 0).toLocaleString()} records cleared.</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Kept for</th><th>Due now</th></tr></thead>
          <tbody>
            {RULES.map((r) => (
              <tr key={r.key}>
                <td>{r.what}</td>
                <td>{days(data.policy[r.days])}</td>
                <td>{data.due[r.key].toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button className="primary" disabled={busy || totalDue === 0} onClick={() => void runNow()}>{totalDue ? `Clear ${totalDue.toLocaleString()} records now` : 'Nothing due'}</button></div>
    </div>
  );
}

function days(d: number): string {
  if (d >= 365 && d % 365 === 0) return `${d / 365} year${d === 365 ? '' : 's'}`;
  return `${d} day${d === 1 ? '' : 's'}`;
}
