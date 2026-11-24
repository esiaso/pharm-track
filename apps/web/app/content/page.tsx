'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Empty, ErrorBox, Field } from '../../components/ui';
import { api, ApiError, download, useApi } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { hasRole, useSession } from '../../lib/session';
import { AffectedDrug, AffectedDrugs, Comparison, ComparisonLine, Errors, ImportResult, ImportSummary, KIND_LABEL } from './ImportResult';

type Tab = 'rules' | 'code-sets' | 'formulary';
const TABS: [Tab, string][] = [['rules', 'Safety rules'], ['code-sets', 'Code sets'], ['formulary', 'Formulary files']];

type RuleSet = { id: string; kind: string; name: string; source: string; version: string; status: string; rowsTotal: number; importedBy: string; importedAt: string; approvedBy: string | null; approvedAt: string | null };
type RuleSetList = { ruleSets: RuleSet[]; unmanaged: Record<string, number> };
type CodeSetImport = { id: string; codeSystem: string; release: string; mode: string; rowsTotal: number; rowsCreated: number; rowsUpdated: number; rowsRetired: number; rowsFailed: number; importedBy: string; importedAt: string };
type RuleCheck = { dryRun: boolean; rowsTotal: number; valid: number; failed: number; errors: { line: number; message: string }[]; comparedTo: Comparison; ruleSet?: RuleSet };

const KIND_TEMPLATE: Record<string, string> = { INTERACTION: 'interactions', CONTRAINDICATION: 'contraindications', DOSE_LIMIT: 'dose-limits' };

/**
 * A file upload that is always checked (dry run) before it is applied.
 * Changing the file or options clears the last check.
 */
function useCheckedImport<R>(path: string, body: Record<string, unknown>) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorBody, setErrorBody] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(body);
  useEffect(() => {
    setResult(null);
    setError(null);
    setErrorBody(null);
  }, [file, key, path]);

  async function send(dryRun: boolean, extra: Record<string, unknown> = {}) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setErrorBody(null);
    try {
      const csv = await file.text();
      const r = await api<R>(path, { body: { ...body, ...extra, csv, dryRun } });
      setResult(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setErrorBody(e.body);
    } finally {
      setBusy(false);
    }
  }
  return { file, setFile, result, error, errorBody, busy, check: () => send(true), apply: (extra?: Record<string, unknown>) => send(false, extra), clear: () => setResult(null) };
}

function FileInput({ onFile, id }: { onFile: (f: File | null) => void; id: string }) {
  return <input id={id} type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />;
}

function TemplateLink({ kind }: { kind: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="link" onClick={() => download(`/content/templates/${kind}`, `${kind}-template.csv`).catch((e) => setError((e as Error).message))}>
        Download template
      </button>
      <ErrorBox error={error} />
    </>
  );
}

export default function ContentPage() {
  const [tab, setTab] = useState<Tab>('rules');
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.some(([t]) => t === h)) setTab(h);
  }, []);
  function choose(t: Tab) {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  }
  return (
    <section className="stack">
      <h1>Clinical content</h1>
      <p className="muted">
        Load the WHO ATC and PPB HPT code lists, the safety rules behind prescribing and dispensing alerts, facility formularies and the drug master from CSV files. Every file is checked before anything changes.
      </p>
      <div className="tabs" role="tablist">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => choose(t)}>{l}</button>
        ))}
      </div>
      {tab === 'rules' && <RulesTab />}
      {tab === 'code-sets' && <CodeSetsTab />}
      {tab === 'formulary' && <FormularyTab />}
    </section>
  );
}

// ── Safety rules ──────────────────────────────────────────────────────────

function RulesTab() {
  const list = useApi<RuleSetList>('/content/rule-sets');
  const [kind, setKind] = useState('INTERACTION');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const imp = useCheckedImport<RuleCheck>('/content/rule-sets/import', { kind, name, source, version, notes: notes || undefined });
  const ready = !!imp.file && name.trim().length >= 2 && source.trim().length >= 2 && version.trim().length >= 1;
  const saved = imp.result && !imp.result.dryRun ? imp.result.ruleSet : null;
  const failed = imp.errorBody?.errors as RuleCheck['errors'] | undefined;

  async function save() {
    const r = await imp.apply();
    if (r) await list.reload();
  }

  const unmanaged = list.data ? Object.entries(list.data.unmanaged).filter(([, n]) => n > 0) : [];
  return (
    <div className="stack">
      <div className="card stack">
        <h3>Load a rule set</h3>
        <p className="small muted">
          Rules are saved as a draft and are not used until a second pharmacist reviews and activates them. Activating a new version retires the previous version from the same source.
        </p>
        <div className="row">
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MTC interaction list" /></Field>
          <Field label="Source"><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Facility MTC" /></Field>
          <Field label="Version"><input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2026.1" size={10} /></Field>
        </div>
        <Field label="Notes for the reviewer (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="row">
          <Field label="CSV file"><FileInput id="rules-file" onFile={imp.setFile} /></Field>
          <TemplateLink kind={KIND_TEMPLATE[kind]!} />
        </div>
        <div className="row">
          <button onClick={() => void imp.check()} disabled={!ready || imp.busy}>Check file</button>
          {imp.result?.dryRun && imp.result.failed === 0 && imp.result.valid > 0 && (
            <button className="primary" onClick={() => void save()} disabled={imp.busy}>Save {imp.result.valid} rules as draft</button>
          )}
        </div>
        <ErrorBox error={imp.error} />
        {failed && <Errors errors={failed} failed={imp.errorBody.failed ?? failed.length} />}
        {imp.result?.dryRun && (
          <div className="stack">
            <div className="stats">
              <span><strong>{imp.result.valid}</strong> valid rules</span>
              <span><strong>{imp.result.failed}</strong> problems</span>
            </div>
            <Errors errors={imp.result.errors} failed={imp.result.failed} />
            {imp.result.failed > 0 && <p className="small muted">Every row must be valid before the set can be saved. Fix the file and check it again.</p>}
            <ComparisonLine c={imp.result.comparedTo} />
          </div>
        )}
        {saved && (
          <div className="notice">
            Saved as a draft. <Link href={`/content/rule-sets/${saved.id}`}>Open it</Link> and ask another pharmacist to review and activate it.
          </div>
        )}
      </div>

      <div className="row">
        <h3>Rule sets</h3>
        <span className="spacer" />
        <button onClick={() => void list.reload()}>Refresh</button>
      </div>
      <ErrorBox error={list.error} />
      {unmanaged.length > 0 && (
        <p className="small muted">
          Also active: {unmanaged.map(([k, n]) => `${n} ${KIND_LABEL[k]!.toLowerCase()} rule${n === 1 ? '' : 's'}`).join(', ')} entered before rule sets (sample data). They are not part of any set.
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Source</th><th>Version</th><th className="right">Rules</th><th>Status</th><th>Loaded</th><th>Approved</th></tr></thead>
          <tbody>
            {(list.data?.ruleSets ?? []).map((s) => (
              <tr key={s.id}>
                <td><Link href={`/content/rule-sets/${s.id}`}>{s.name}</Link></td>
                <td>{KIND_LABEL[s.kind]}</td>
                <td>{s.source}</td>
                <td className="mono">{s.version}</td>
                <td className="right">{s.rowsTotal}</td>
                <td><Badge value={s.status} /></td>
                <td className="small">{s.importedBy}<br />{dateTime(s.importedAt)}</td>
                <td className="small">{s.approvedBy ? <>{s.approvedBy}<br />{dateTime(s.approvedAt)}</> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && list.data.ruleSets.length === 0 && <Empty>No rule sets loaded yet.</Empty>}
      </div>
    </div>
  );
}

// ── Code sets ─────────────────────────────────────────────────────────────

function CodeSetsTab() {
  const { session } = useSession();
  const isAdmin = session.roles.includes('ADMINISTRATOR');
  const imports = useApi<CodeSetImport[]>('/content/code-sets/imports');
  const review = useApi<AffectedDrug[]>('/content/code-sets/drugs-needing-review');
  const [system, setSystem] = useState<'atc' | 'hpt'>('atc');
  const [release, setRelease] = useState('');
  const [mode, setMode] = useState('PARTIAL');
  const imp = useCheckedImport<ImportSummary>(`/content/code-sets/${system}/import`, { release, mode });
  const needsForce = typeof imp.errorBody?.message === 'string' && /would retire/.test(imp.errorBody.message);
  const done = imp.result && !imp.result.dryRun;

  async function run(force = false) {
    const r = await imp.apply(force ? { force: true } : {});
    if (r) await Promise.all([imports.reload(), review.reload()]);
  }

  return (
    <div className="stack">
      {isAdmin ? (
        <div className="card stack">
          <h3>Load a code list release</h3>
          <p className="small muted">
            The WHO ATC/DDD index loads as exported (columns ATC code, ATC level name, DDD, U, Adm.R, Note). The PPB HPT list loads as CSV or as the FHIR CodeSystem JSON from the DHA terminology server; only product codes (PH, GE, FS) are loaded from it. A full release marks codes that are no longer listed as retired: existing drugs keep them, but they are flagged for re-coding and cannot be used for new drugs.
          </p>
          <div className="row">
            <Field label="Code list">
              <select value={system} onChange={(e) => setSystem(e.target.value as 'atc' | 'hpt')}>
                <option value="atc">WHO ATC / DDD</option>
                <option value="hpt">PPB HPT codes</option>
              </select>
            </Field>
            <Field label="Release"><input value={release} onChange={(e) => setRelease(e.target.value)} placeholder={system === 'atc' ? 'e.g. WHO-ATC-2026' : 'e.g. PPB-HPT-2026-11'} /></Field>
            <Field label="Type">
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="PARTIAL">Partial update (add and change only)</option>
                <option value="FULL">Full release (also retire missing codes)</option>
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label={system === 'hpt' ? 'CSV or JSON file' : 'CSV file'}><FileInput id="codes-file" onFile={imp.setFile} /></Field>
            <TemplateLink kind={system} />
          </div>
          <div className="row">
            <button onClick={() => void imp.check()} disabled={!imp.file || release.trim().length < 2 || imp.busy}>Check file</button>
            {imp.result?.dryRun && (imp.result.mode === 'PARTIAL' || imp.result.failed === 0) && (
              <button className="primary" onClick={() => void run()} disabled={imp.busy}>Load {release}</button>
            )}
            {needsForce && <button className="danger" onClick={() => void run(true)} disabled={imp.busy}>Load anyway</button>}
          </div>
          {imp.result?.dryRun && imp.result.mode === 'FULL' && imp.result.failed > 0 && (
            <p className="small muted">A full release can only be loaded when every row is valid, otherwise codes with errors would be retired.</p>
          )}
          <ErrorBox error={imp.error} />
          {imp.errorBody?.errors && <Errors errors={imp.errorBody.errors} failed={imp.errorBody.errors.length} />}
          {imp.result && <ImportResult r={imp.result} />}
          {done && <div className="notice">Loaded. The import is recorded below.</div>}
        </div>
      ) : (
        <p className="muted small">Code list releases are loaded by an administrator.</p>
      )}

      <AffectedDrugs drugs={review.data ?? []} title="Drugs that need re-coding" />
      <ErrorBox error={review.error} />

      <h3>Import history</h3>
      <ErrorBox error={imports.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>List</th><th>Release</th><th>Type</th><th className="right">New</th><th className="right">Changed</th><th className="right">Retired</th><th className="right">Problems</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            {(imports.data ?? []).map((i) => (
              <tr key={i.id}>
                <td>{SYSTEM_LABEL[i.codeSystem] ?? i.codeSystem}</td>
                <td className="mono">{i.release}</td>
                <td><Badge value={i.mode} /></td>
                <td className="right">{i.rowsCreated}</td>
                <td className="right">{i.rowsUpdated}</td>
                <td className="right">{i.rowsRetired}</td>
                <td className="right">{i.rowsFailed}</td>
                <td className="small">{i.importedBy}</td>
                <td className="small">{dateTime(i.importedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {imports.data && imports.data.length === 0 && <Empty>Nothing imported yet.</Empty>}
      </div>
    </div>
  );
}

const SYSTEM_LABEL: Record<string, string> = { WHO_ATC: 'WHO ATC', PPB_HPT: 'PPB HPT', DRUG_MASTER: 'Drug master', FACILITY_FORMULARY: 'Facility formulary' };

// ── Facility formulary and drug master ────────────────────────────────────

function FormularyTab() {
  const { session } = useSession();
  const [facilityId, setFacilityId] = useState(session.facilityId);
  const [mode, setMode] = useState('PARTIAL');
  const fac = useCheckedImport<ImportSummary>(`/content/facilities/${encodeURIComponent(facilityId)}/formulary/import`, { mode });
  const [reason, setReason] = useState('');
  const drugs = useCheckedImport<ImportSummary>('/content/drugs/import', { reason });
  const [error, setError] = useState<string | null>(null);
  const canWrite = hasRole(session, 'PHARMACIST');

  return (
    <div className="stack">
      <div className="card stack">
        <h3>Facility formulary</h3>
        <p className="small muted">
          Which drugs a facility stocks and which are restricted. A full load removes this facility&apos;s entries that are not in the file, so those drugs fall back to their suite-wide status. To copy one facility&apos;s formulary to another, download it and load it there.
        </p>
        <div className="row">
          <Field label="Facility"><input value={facilityId} onChange={(e) => setFacilityId(e.target.value)} size={12} /></Field>
          <Field label="Type">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="PARTIAL">Add and change only</option>
              <option value="FULL">Full formulary (remove items not listed)</option>
            </select>
          </Field>
          <button type="button" onClick={() => download(`/content/facilities/${encodeURIComponent(facilityId)}/formulary/export`, `formulary-${facilityId}.csv`).catch((e) => setError((e as Error).message))}>
            Download current formulary
          </button>
        </div>
        {canWrite && (
          <>
            <div className="row">
              <Field label="CSV file"><FileInput id="fac-file" onFile={fac.setFile} /></Field>
              <TemplateLink kind="facility-formulary" />
            </div>
            <div className="row">
              <button onClick={() => void fac.check()} disabled={!fac.file || !facilityId || fac.busy}>Check file</button>
              {fac.result?.dryRun && (fac.result.mode === 'PARTIAL' || fac.result.failed === 0) && (
                <button className="primary" onClick={() => void fac.apply()} disabled={fac.busy}>Load into {facilityId}</button>
              )}
            </div>
          </>
        )}
        <ErrorBox error={fac.error ?? error} />
        {fac.result && <ImportResult r={fac.result} removedLabel="Removed" />}
      </div>

      {canWrite && (
        <div className="card stack">
          <h3>Drug master</h3>
          <p className="small muted">
            Adds new drugs and updates existing ones by HPT code. Blank optional columns keep the current value. Each change is versioned with the reason below and sent to CliniTrack&apos;s prescription pad.
          </p>
          <div className="row">
            <Field label="CSV file"><FileInput id="drugs-file" onFile={drugs.setFile} /></Field>
            <TemplateLink kind="drugs" />
          </div>
          <Field label="Reason for the change"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 2026 formulary review" /></Field>
          <div className="row">
            <button onClick={() => void drugs.check()} disabled={!drugs.file || reason.trim().length < 3 || drugs.busy}>Check file</button>
            {drugs.result?.dryRun && (drugs.result.created ?? 0) + (drugs.result.updated ?? 0) > 0 && (
              <button className="primary" onClick={() => void drugs.apply()} disabled={drugs.busy}>
                Apply {(drugs.result.created ?? 0) + (drugs.result.updated ?? 0)} changes
              </button>
            )}
          </div>
          <ErrorBox error={drugs.error} />
          {drugs.result && <ImportResult r={drugs.result} />}
        </div>
      )}
    </div>
  );
}
