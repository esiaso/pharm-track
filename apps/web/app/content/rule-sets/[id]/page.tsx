'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Dl, Empty, ErrorBox, Field } from '../../../../components/ui';
import { api, download, useApi } from '../../../../lib/api';
import { dateTime } from '../../../../lib/format';
import { hasRole, useSession } from '../../../../lib/session';
import { KIND_LABEL } from '../../ImportResult';

type Rule = Record<string, any> & { id: string };
type Detail = {
  id: string;
  kind: 'INTERACTION' | 'CONTRAINDICATION' | 'DOSE_LIMIT';
  name: string;
  source: string;
  version: string;
  status: string;
  notes: string | null;
  importedBy: string;
  importedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
  ruleCount: number;
  rules: Rule[];
  comparedTo: null | {
    ruleSetId: string;
    name: string;
    version: string;
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    addedKeys: string[];
    removedKeys: string[];
    changedRules: { key: string; fields: string[] }[];
  };
};

const n = (v: unknown) => (v === null || v === undefined ? '' : String(Number(v)));

function ruleColumns(kind: Detail['kind']): [string, (r: Rule) => React.ReactNode][] {
  if (kind === 'INTERACTION')
    return [
      ['Drug or class A', (r) => <span className="mono">{r.atcPrefixA}</span>],
      ['Drug or class B', (r) => <span className="mono">{r.atcPrefixB}</span>],
      ['Severity', (r) => <Badge value={r.severity} />],
      ['Effect', (r) => r.description],
      ['What to do', (r) => r.management ?? '–'],
    ];
  if (kind === 'CONTRAINDICATION')
    return [
      ['Drug or class', (r) => <span className="mono">{r.atcPrefix}</span>],
      ['Diagnosis', (r) => <span className="mono">{r.diagnosisSystem} {r.diagnosisPrefix}</span>],
      ['Severity', (r) => <Badge value={r.severity} />],
      ['Why', (r) => r.rationale],
    ];
  return [
    ['Drug or class', (r) => <span className="mono">{r.hptCode ?? r.atcPrefix}</span>],
    ['Applies to', (r) => scope(r) || 'Everyone'],
    ['Max single', (r) => (r.maxSingleDose ? `${n(r.maxSingleDose)} ${r.doseUnit}${r.perKg ? '/kg' : ''}` : '–')],
    ['Max daily', (r) => (r.maxDailyDose ? `${n(r.maxDailyDose)} ${r.doseUnit}${r.perKg ? '/kg' : ''}` : '–')],
    ['Severity', (r) => <Badge value={r.severity} />],
    ['Note', (r) => r.note ?? '–'],
  ];
}

function scope(r: Rule): string {
  const parts: string[] = [];
  if (r.route) parts.push(r.route.toLowerCase());
  if (r.minAgeMonths !== null || r.maxAgeMonths !== null) parts.push(`age ${r.minAgeMonths ?? 0}–${r.maxAgeMonths ?? '∞'} months`);
  if (r.minWeightKg !== null || r.maxWeightKg !== null) parts.push(`weight ${n(r.minWeightKg) || 0}–${n(r.maxWeightKg) || '∞'} kg`);
  if (r.crClBelow !== null) parts.push(`CrCl below ${n(r.crClBelow)} mL/min`);
  if (r.hepaticImpairment) parts.push('hepatic impairment');
  return parts.join(', ');
}

export default function RuleSetPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const { data: s, error: loadError, reload } = useApi<Detail>(`/content/rule-sets/${id}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState('');
  const isPharmacist = hasRole(session, 'PHARMACIST');
  const ownImport = s?.importedBy === session.userId;

  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      await api(`/content/rule-sets/${id}/${path}`, { body });
      setRetiring(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <section className="stack"><Link href="/content">← Clinical content</Link><ErrorBox error={loadError} />{!loadError && <p className="muted">Loading…</p>}</section>;
  const cols = ruleColumns(s.kind);
  const c = s.comparedTo;
  return (
    <section className="stack">
      <Link href="/content">← Clinical content</Link>
      <div className="row" style={{ alignItems: 'center' }}>
        <h1>{s.name}</h1>
        <Badge value={s.status} />
        <span className="spacer" />
        <button onClick={() => download(`/content/rule-sets/${id}/export`, `${s.kind.toLowerCase()}-${s.source}-${s.version}.csv`).catch((e) => setError((e as Error).message))}>Download CSV</button>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <Dl
          items={[
            ['Kind', KIND_LABEL[s.kind]],
            ['Source', s.source],
            ['Version', s.version],
            ['Rules', s.ruleCount],
            ['Loaded by', `${s.importedBy}, ${dateTime(s.importedAt)}`],
            ['Approved by', s.approvedBy ? `${s.approvedBy}, ${dateTime(s.approvedAt)}` : '–'],
            ...(s.retiredAt ? ([['Retired by', `${s.retiredBy}, ${dateTime(s.retiredAt)}`]] as [string, string][]) : []),
          ]}
        />
        {s.notes && <p className="small">{s.notes}</p>}
      </div>

      {s.status === 'DRAFT' && (
        <div className="card stack">
          <h3>Review</h3>
          {c ? (
            <>
              <p>
                Activating this set replaces version {c.version} ({c.name}), which is active now: <strong>{c.added}</strong> rules added, <strong>{c.removed}</strong> removed, <strong>{c.changed}</strong> changed and {c.unchanged} unchanged.
              </p>
              {c.changedRules.length > 0 && <p className="small">Changed: {c.changedRules.map((r) => `${r.key.replace(/\|/g, ' / ')} (${r.fields.join(', ')})`).join('; ')}</p>}
              {c.removedKeys.length > 0 && <p className="small">Removed: <span className="mono">{c.removedKeys.map((k) => k.replace(/\|/g, ' / ')).join('; ')}</span></p>}
            </>
          ) : (
            <p>No set from {s.source} is active yet. Activating this one adds all {s.ruleCount} rules to prescribing and dispensing checks.</p>
          )}
          {isPharmacist && (
            <div className="row">
              <button className="primary" disabled={busy || ownImport} onClick={() => void act('activate')}>Activate</button>
              <button className="danger" disabled={busy} onClick={() => setRetiring(true)}>Reject</button>
            </div>
          )}
          {ownImport && <p className="small muted">You loaded this set, so a different pharmacist has to activate it.</p>}
        </div>
      )}
      {s.status === 'ACTIVE' && isPharmacist && (
        <div className="row">
          <p className="muted small">These rules are in use for every safety check.</p>
          <span className="spacer" />
          <button className="danger" disabled={busy} onClick={() => setRetiring(true)}>Retire</button>
        </div>
      )}
      {retiring && (
        <div className="card stack">
          <Field label={s.status === 'DRAFT' ? 'Why are you rejecting it?' : 'Why are you retiring it? Its rules stop being checked immediately.'}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="row">
            <button className="danger" disabled={busy || reason.trim().length < 5} onClick={() => void act('retire', { reason })}>{s.status === 'DRAFT' ? 'Reject' : 'Retire'}</button>
            <button onClick={() => setRetiring(false)}>Cancel</button>
          </div>
        </div>
      )}

      <h3>Rules{s.ruleCount > s.rules.length ? ` (first ${s.rules.length} of ${s.ruleCount}; download the CSV for all)` : ''}</h3>
      <div className="table-wrap">
        <table>
          <thead><tr>{cols.map(([h]) => <th key={h}>{h}</th>)}<th>Ref</th></tr></thead>
          <tbody>
            {s.rules.map((r) => (
              <tr key={r.id}>{cols.map(([h, f]) => <td key={h}>{f(r)}</td>)}<td className="small mono">{r.externalRef ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
        {s.rules.length === 0 && <Empty>No rules.</Empty>}
      </div>
    </section>
  );
}
