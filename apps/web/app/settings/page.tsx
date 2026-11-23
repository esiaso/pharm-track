'use client';

import { useEffect, useState } from 'react';
import { Badge, ErrorBox, Field } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { hasRole, useSession } from '../../lib/session';

type Profile = { facilityId: string; name: string; phone: string | null; updatedAt: string } | null;
type Template = {
  purpose: string;
  language: 'en' | 'sw';
  body: string;
  source: 'facility' | 'suite' | 'default';
  updatedAt: string | null;
  namesMedicine: boolean;
  defaultBody: string;
  privateBody: string;
};
type Templates = { placeholders: string[]; templates: Template[] };

const PURPOSE: Record<string, [string, string]> = {
  REFILL_REMINDER: ['Refill reminder', 'Sent a few days before a refill is due.'],
  REFILL_DUE: ['Refill due today', 'Sent on the day a refill is due.'],
  REFILL_OVERDUE: ['Refill overdue', 'Sent when a refill has not been collected after the grace period.'],
  READY_FOR_COLLECTION: ['Ready for collection', 'Sent from the dispense screen when medicine is ready.'],
};
const LANGS: [Template['language'], string][] = [['en', 'English'], ['sw', 'Kiswahili']];
const SOURCE: Record<Template['source'], string> = { facility: 'This facility', suite: 'SynergyOne default', default: 'Built-in' };

/** Fills placeholders with sample values so the preview reads like a real message. */
function preview(body: string, facility: { name?: string; phone?: string | null }) {
  const vars: Record<string, string> = {
    patientFirstName: 'Amina',
    drugName: 'Metformin 500 mg',
    dueDate: '28 Nov 2026',
    facilityName: facility.name || 'the pharmacy',
    facilityPhone: facility.phone || '',
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`).replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

/** SMS parts: 160 characters in one message, 153 per part after that (GSM 7-bit). */
const parts = (len: number) => (len <= 160 ? 1 : Math.ceil(len / 153));

export default function SettingsPage() {
  const { session } = useSession();
  const admin = hasRole(session, 'ADMINISTRATOR');
  const fid = session.facilityId;
  const profile = useApi<Profile>(`/facilities/${encodeURIComponent(fid)}/profile`);
  const templates = useApi<Templates>(`/facilities/${encodeURIComponent(fid)}/sms-templates`);
  const facility = { name: profile.data?.name, phone: profile.data?.phone };

  return (
    <section className="stack">
      <div>
        <h1>Settings</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Facility {fid}. The name and phone print on dispensing labels and appear in SMS.
          {!admin && ' Only an administrator can change these.'}
        </p>
      </div>
      <ProfileCard fid={fid} profile={profile.data} error={profile.error} admin={admin} onSaved={(p) => profile.setData(p)} />
      <SmsSection fid={fid} data={templates.data} error={templates.error} admin={admin} facility={facility} reload={templates.reload} />
    </section>
  );
}

function ProfileCard({ fid, profile, error, admin, onSaved }: { fid: string; profile: Profile; error: string | null; admin: boolean; onSaved: (p: Profile) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setName(profile?.name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const p = await api<Profile>(`/facilities/${encodeURIComponent(fid)}/profile`, { method: 'PUT', body: { name, phone: phone || undefined } });
      onSaved(p);
      setMsg('Saved.');
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={save}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3>Facility profile</h3>
        <span className="spacer" />
        {profile ? <span className="small muted">Updated {dateTime(profile.updatedAt)}</span> : <Badge value="DRAFT" />}
      </div>
      {!profile && !error && <p className="small muted">Not set yet. Labels and SMS say &ldquo;the pharmacy&rdquo; until a name is saved.</p>}
      <ErrorBox error={error ?? err} />
      <div className="grid2">
        <Field label="Facility name"><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} disabled={!admin} /></Field>
        <Field label="Phone for enquiries"><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} placeholder="e.g. 0700 000 000" disabled={!admin} /></Field>
      </div>
      {admin && (
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="primary" disabled={busy || name.trim().length < 2}>Save profile</button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
      )}
    </form>
  );
}

function SmsSection({ fid, data, error, admin, facility, reload }: { fid: string; data: Templates | null; error: string | null; admin: boolean; facility: { name?: string; phone?: string | null }; reload: () => Promise<void> }) {
  const [lang, setLang] = useState<Template['language']>('en');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const naming = data?.templates.filter((t) => t.namesMedicine) ?? [];

  async function hideAll() {
    setBusy(true);
    setErr(null);
    try {
      for (const t of naming) {
        await api('/sms-templates', { method: 'PUT', body: { facilityId: fid, purpose: t.purpose, language: t.language, body: t.privateBody } });
      }
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>SMS wording</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>Each patient gets messages in the language set in CliniTrack. Changes apply to messages queued from now on.</p>
        </div>
        <span className="spacer" />
        {admin && naming.length > 0 && (
          <button onClick={hideAll} disabled={busy}>Remove medicine names from all messages</button>
        )}
      </div>
      {naming.length > 0 ? (
        <div className="alert warn small">
          <strong>{naming.length} of {data?.templates.length} messages name the medicine.</strong> On a shared phone this tells others what the patient is treated for.
          The data protection review suggests wording without it.
        </div>
      ) : data ? (
        <div className="notice small">No message names the medicine.</div>
      ) : null}
      <ErrorBox error={error ?? err} />
      <div className="tabs" role="tablist">
        {LANGS.map(([l, title]) => (
          <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)}>{title}</button>
        ))}
      </div>
      {data && (
        <p className="small muted" style={{ margin: 0 }}>
          Placeholders: {data.placeholders.map((p) => <code key={p} className="mono" style={{ marginRight: 8 }}>{`{{${p}}}`}</code>)}
        </p>
      )}
      {data?.templates.filter((t) => t.language === lang).map((t) => (
        <TemplateCard key={`${t.purpose}-${t.language}-${t.updatedAt}-${t.body}`} fid={fid} t={t} admin={admin} facility={facility} reload={reload} />
      ))}
    </div>
  );
}

function TemplateCard({ fid, t, admin, facility, reload }: { fid: string; t: Template; admin: boolean; facility: { name?: string; phone?: string | null }; reload: () => Promise<void> }) {
  const [body, setBody] = useState(t.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = body.trim() !== t.body.trim();
  const text = preview(body, facility);
  const n = parts(text.length);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const save = (b: string) => run(() => api('/sms-templates', { method: 'PUT', body: { facilityId: fid, purpose: t.purpose, language: t.language, body: b } }));
  const reset = () => run(() => api(`/facilities/${encodeURIComponent(fid)}/sms-templates/${t.purpose}/${t.language}`, { method: 'DELETE' }));

  const [title, hint] = PURPOSE[t.purpose] ?? [t.purpose, ''];
  return (
    <div className="card stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <p className="small muted" style={{ margin: 0 }}>{hint}</p>
        </div>
        <span className="spacer" />
        {/drugName/.test(body) && <span className="badge warn">Names the medicine</span>}
        <span className={`badge ${t.source === 'facility' ? 'info' : 'neutral'}`}>{SOURCE[t.source]}</span>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={480} disabled={!admin} aria-label={`${title} wording`} />
      <div className="label-preview">
        <span className="small muted">Preview</span>
        <div>{text}</div>
        <span className={`small ${n > 1 ? '' : 'muted'}`}>{text.length} characters, {n} SMS{n > 1 ? ' (costs more)' : ''}</span>
      </div>
      <ErrorBox error={err} />
      {admin && (
        <div className="row">
          <button className="primary" disabled={busy || !dirty || body.trim().length < 10} onClick={() => save(body)}>Save</button>
          {dirty && <button disabled={busy} onClick={() => setBody(t.body)}>Undo changes</button>}
          {body.trim() !== t.privateBody && <button disabled={busy} onClick={() => setBody(t.privateBody)}>Use wording without the medicine</button>}
          {t.source === 'facility' && <button disabled={busy} onClick={reset}>Reset to default</button>}
        </div>
      )}
    </div>
  );
}
