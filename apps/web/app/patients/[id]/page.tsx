'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Empty, ErrorBox, Field } from '../../../components/ui';
import { api, useApi } from '../../../lib/api';
import { date, label, n } from '../../../lib/format';
import type { Allergy, PrescriptionItem, RefillSchedule } from '../../../lib/types';

type HistoryRx = {
  id: string;
  externalId: string;
  status: string;
  signedAt: string;
  prescriberId: string;
  items: (PrescriptionItem & { dispenseLines: { quantity: string; dispensedAt: string }[]; refillSchedule: RefillSchedule | null })[];
};
type Adr = { id: string; description: string; seriousness: string; causality: string; outcome: string; onsetDate: string; ppbReportStatus: string; ppbReference: string | null; drug: { genericName: string; strength: string; hptCode: string } };
type Contact = { firstName: string | null; phoneE164: string | null; smsOptIn: boolean; language: string } | null;

export default function PatientPage() {
  const { id } = useParams<{ id: string }>();
  const pid = decodeURIComponent(id);
  const allergies = useApi<Allergy[]>(`/patients/${encodeURIComponent(pid)}/allergies?includeInactive=true`);
  const history = useApi<HistoryRx[]>(`/patients/${encodeURIComponent(pid)}/medication-history`);
  const adrs = useApi<Adr[]>(`/adrs?patientId=${encodeURIComponent(pid)}`);
  const contact = useApi<Contact>(`/patients/${encodeURIComponent(pid)}/contact-preferences`);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className="stack">
      <div>
        <Link href="/patients" className="small">← Patients</Link>
        <h1>{pid}</h1>
        <p className="muted small">
          SMS reminders:{' '}
          {contact.data?.smsOptIn ? `on (${contact.data.phoneE164}, ${contact.data.language === 'sw' ? 'Kiswahili' : 'English'})` : 'off. Consent is recorded in CliniTrack.'}
        </p>
      </div>
      {notice && <div className="notice">{notice}</div>}

      <h2>Allergies</h2>
      <ErrorBox error={allergies.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Reaction</th><th>Severity</th><th>Verification</th><th>Status</th><th>Source</th><th /></tr></thead>
          <tbody>
            {allergies.data?.map((a) => (
              <tr key={a.id}>
                <td>{a.agentText}{a.atcPrefix && <span className="mono muted"> ATC {a.atcPrefix}</span>}</td>
                <td>{a.reaction ?? '–'}</td>
                <td><Badge value={a.severity} /></td>
                <td><Badge value={a.verificationStatus} /></td>
                <td>{label(a.status)}</td>
                <td className="small">{a.source === 'CLINITRACK' ? 'CliniTrack' : 'PharmTrack'}</td>
                <td>
                  {a.status === 'ACTIVE' && a.verificationStatus === 'UNCONFIRMED' && (
                    <button className="link" onClick={async () => { await api(`/allergies/${a.id}`, { method: 'PATCH', body: { verificationStatus: 'CONFIRMED' } }); setNotice('Allergy confirmed and shared with CliniTrack.'); allergies.reload(); }}>Confirm</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {allergies.data?.length === 0 && <Empty>No known allergies recorded.</Empty>}
      </div>
      <AddAllergy patientId={pid} onSaved={() => { setNotice('Allergy recorded and shared with CliniTrack.'); allergies.reload(); }} />

      <h2>Medication history</h2>
      <ErrorBox error={history.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Signed</th><th>Medicine</th><th>Dose</th><th className="right">Dispensed</th><th>Refills</th><th>Prescription</th></tr></thead>
          <tbody>
            {history.data?.flatMap((rx) =>
              rx.items.map((it) => (
                <tr key={it.id}>
                  <td>{date(rx.signedAt)}</td>
                  <td>{it.drug.genericName} {it.drug.strength}<div className="mono small muted">{it.atcCode} · {it.hptCode}</div></td>
                  <td>{n(it.dose)} {it.doseUnit} {it.frequency} × {it.durationDays} d</td>
                  <td className="right">{it.dispenseLines.reduce((s, l) => s + n(l.quantity), 0)}</td>
                  <td>{it.refillSchedule ? <Link href={`/refills/${it.refillSchedule.id}`}><Badge value={it.refillSchedule.status} /> {it.refillSchedule.refillsUsed}/{it.refillSchedule.refillsAuthorised}</Link> : '–'}</td>
                  <td className="mono small">{rx.externalId} <Badge value={rx.status} /></td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        {history.data?.length === 0 && <Empty>No prescriptions on record.</Empty>}
      </div>

      <h2>Adverse drug reactions</h2>
      <ErrorBox error={adrs.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Onset</th><th>Suspected drug</th><th>Reaction</th><th>Seriousness</th><th>Causality</th><th>PPB report</th></tr></thead>
          <tbody>
            {adrs.data?.map((r) => (
              <tr key={r.id}>
                <td>{date(r.onsetDate)}</td>
                <td>{r.drug.genericName} {r.drug.strength}</td>
                <td>{r.description}</td>
                <td>{label(r.seriousness)}</td>
                <td>{label(r.causality)}</td>
                <td>
                  {label(r.ppbReportStatus)}{r.ppbReference && <div className="mono small">{r.ppbReference}</div>}
                  <div><a href="#" onClick={async (e) => { e.preventDefault(); const rep = await api(`/adrs/${r.id}/ppb-export`); download(`adr-${r.id}.json`, rep); adrs.reload(); }}>Download PPB report</a></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {adrs.data?.length === 0 && <Empty>No adverse reactions reported.</Empty>}
      </div>
      <ReportAdr patientId={pid} onSaved={() => { setNotice('Adverse reaction recorded.'); adrs.reload(); }} />
    </section>
  );
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function AddAllergy({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <div><button onClick={() => setOpen(true)}>Record allergy</button></div>;
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        try {
          await api('/allergies', {
            body: {
              patientId,
              agentType: f.agentType,
              hptCode: f.agentType === 'DRUG' ? f.code : undefined,
              atcPrefix: f.agentType === 'DRUG_CLASS' ? f.code : undefined,
              agentText: f.agentText,
              reaction: f.reaction || undefined,
              severity: f.severity,
              verificationStatus: f.verificationStatus,
            },
          });
          setOpen(false);
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <ErrorBox error={error} />
      <div className="row">
        <Field label="Type">
          <select name="agentType" defaultValue="DRUG_CLASS">
            <option value="DRUG">Specific drug (HPT code)</option>
            <option value="DRUG_CLASS">Drug class (ATC prefix)</option>
            <option value="NON_DRUG">Non-drug</option>
          </select>
        </Field>
        <Field label="HPT code or ATC prefix"><input name="code" placeholder="e.g. J01C" /></Field>
        <Field label="Agent"><input name="agentText" required placeholder="e.g. Penicillins" /></Field>
        <Field label="Reaction"><input name="reaction" placeholder="e.g. Rash" /></Field>
        <Field label="Severity">
          <select name="severity" defaultValue="MODERATE">
            <option value="MILD">Mild</option><option value="MODERATE">Moderate</option><option value="SEVERE">Severe</option><option value="LIFE_THREATENING">Life-threatening</option>
          </select>
        </Field>
        <Field label="Verification">
          <select name="verificationStatus" defaultValue="UNCONFIRMED">
            <option value="UNCONFIRMED">Unconfirmed</option><option value="CONFIRMED">Confirmed</option>
          </select>
        </Field>
      </div>
      <div className="row"><button className="primary">Save allergy</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

function ReportAdr({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <div><button onClick={() => setOpen(true)}>Report adverse reaction</button></div>;
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        try {
          await api('/adrs', { body: { patientId, hptCode: f.hptCode, onsetDate: f.onsetDate, description: f.description, seriousness: f.seriousness, actionTaken: f.actionTaken || undefined } });
          setOpen(false);
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <ErrorBox error={error} />
      <div className="row">
        <Field label="Suspected drug (HPT code)"><input name="hptCode" required /></Field>
        <Field label="Onset date"><input name="onsetDate" type="date" required /></Field>
        <Field label="Seriousness">
          <select name="seriousness" defaultValue="NON_SERIOUS">
            {['NON_SERIOUS', 'SERIOUS_HOSPITALISATION', 'SERIOUS_LIFE_THREATENING', 'SERIOUS_DISABILITY', 'SERIOUS_CONGENITAL_ANOMALY', 'SERIOUS_DEATH'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="What happened"><textarea name="description" required minLength={5} /></Field>
      <Field label="Action taken"><input name="actionTaken" placeholder="e.g. Drug stopped" /></Field>
      <div className="row"><button className="primary">Save report</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
