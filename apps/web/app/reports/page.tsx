'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, ErrorBox, Field } from '../../components/ui';
import { api, ApiError, download, useApi } from '../../lib/api';
import { date, dateTime, label } from '../../lib/format';
import { useSession } from '../../lib/session';

type Tab = 'returns' | 'stock-outs' | 'prescribing' | 'adherence' | 'controlled' | 'adrs';
const TABS: [Tab, string][] = [['returns', 'Monthly returns'], ['stock-outs', 'Stock-outs'], ['prescribing', 'Prescribing'], ['adherence', 'Adherence'], ['controlled', 'Controlled drugs'], ['adrs', 'ADRs to PPB']];

type Check = { level: 'warning' | 'info'; code: string; message: string; count: number };
type Run = {
  id: string;
  kind: 'PHARMACY_RETURN' | 'STOCK_OUT';
  facilityId: string;
  period: string;
  version: number;
  status: string;
  summary: Record<string, number>;
  checks: Check[];
  data?: any;
  generatedBy: string;
  generatedAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  externalRef: string | null;
  amendsId: string | null;
  /** State of the outgoing message once submitted. */
  delivery: 'PENDING' | 'DELIVERED' | 'DEAD' | null;
};
type StockOut = { storeId: string; hptCode: string; genericName: string | null; strength: string | null; episodes: number; daysOut: number; outAtEnd: boolean; prescriptionItemsAffected: number; firstOutAt: string };
type Indicators = { encounters: number; items: number; avgMedicinesPerEncounter: number; pctEncountersWithAntibiotic: number; pctEncountersWithInjection: number; pctItemsOnFormulary: number; pctEncountersWithAntimicrobial: number; overridesPer100Items: number };
type Prescribing = { facility: Indicators; prescribers: ({ prescriberId: string } & Indicators)[] };
type AdherenceRow = { scheduleId: string; patientId: string; hptCode: string; genericName: string; strength: string; fills: number; daysOfSupplyPerFill: number; observedDays: number; pdc: number; adherent: boolean; lateRefills: number; averageDaysLate: number; status: string };
type AdherenceReport = { threshold: number; summary: { items: number; patients: number; medianPdc: number | null; pctAdherent: number; lateRefills: number; overdueNow: number }; rows: AdherenceRow[] };
type RegisterEntry = {
  id: string; recordedAt: string; storeId: string; drugId: string; hptCode: string; genericName: string; strength: string; unitOfIssue: string; schedule: string;
  patientId: string; prescriptionRef: string; prescriberId: string; orderId: string; batchNumber: string; quantity: number; quantityReturned: number; dispensedBy: string; witnessedBy: string;
};
type RegisterTotal = { drugId: string; hptCode: string; genericName: string; strength: string; unitOfIssue: string; schedule: string; entries: number; issued: number; returned: number; net: number };
type Register = { entries: RegisterEntry[]; totals: RegisterTotal[]; truncated: boolean };
type AdrRow = { id: string; patientId: string; seriousness: string; description: string; reportedAt: string; reportedBy: string; ppbReportStatus: string; dueBy: string; overdue: boolean; drug: { genericName: string; strength: string; hptCode: string } };
type AdrQueue = { targets: { serious: number; nonSerious: number }; pending: AdrRow[]; counts: { pending: number; overdue: number; submitted: number; acknowledged: number } };

const KIND_LABEL = { PHARMACY_RETURN: 'Pharmacy return (to CliniTrack for SHA/DHA)', STOCK_OUT: 'Stock-out report (to SupplyTrack)' };
const SUMMARY_LABEL: Record<string, string> = {
  dispenseLines: 'Lines dispensed',
  products: 'Products',
  quantity: 'Units',
  value: 'Value (KES)',
  ddds: 'DDDs',
  antimicrobialDdds: 'Antimicrobial DDDs',
  refillsDispensed: 'Refills dispensed',
  adrsReported: 'ADRs reported',
  itemsOut: 'Items out of stock',
  totalDaysOut: 'Days out (total)',
  stillOut: 'Still out at month end',
  prescriptionItemsAffected: 'Prescription items affected',
};

/** "YYYY-MM" for the previous month in local time: the usual month to report. */
function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Date range inputs (local dates) as ISO bounds; `to` is inclusive of that day. */
function useRange(days = 30) {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [from, setFrom] = useState(iso(new Date(today.getTime() - days * 86_400_000)));
  const [to, setTo] = useState(iso(today));
  const query = useMemo(() => {
    const f = new Date(`${from}T00:00:00`);
    const t = new Date(`${to}T00:00:00`);
    t.setDate(t.getDate() + 1);
    return `from=${encodeURIComponent(f.toISOString())}&to=${encodeURIComponent(t.toISOString())}`;
  }, [from, to]);
  const inputs = (
    <>
      <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
    </>
  );
  return { query, inputs };
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('returns');
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.some(([t]) => t === h)) setTab(h);
  }, []);
  return (
    <section className="stack">
      <h1>Reports</h1>
      <div className="tabs" role="tablist">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); history.replaceState(null, '', `#${t}`); }}>{l}</button>
        ))}
      </div>
      {tab === 'returns' && <ReturnsTab />}
      {tab === 'stock-outs' && <StockOutsTab />}
      {tab === 'prescribing' && <PrescribingTab />}
      {tab === 'adherence' && <AdherenceTab />}
      {tab === 'controlled' && <ControlledTab />}
      {tab === 'adrs' && <AdrTab />}
    </section>
  );
}

// ── Monthly returns ───────────────────────────────────────────────────────

function ReturnsTab() {
  const { session } = useSession();
  const [kind, setKind] = useState<Run['kind']>('PHARMACY_RETURN');
  const [period, setPeriod] = useState(lastMonth());
  const [facilityId, setFacilityId] = useState(session.facilityId);
  const runs = useApi<Run[]>(`/reports/runs?facilityId=${encodeURIComponent(facilityId)}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Run>('/reports/runs', { body: { kind, facilityId, period } });
      setSelected(r.id);
      await runs.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <h3>Prepare a monthly report</h3>
        <p className="small muted">
          The report is built from PharmTrack&apos;s records and kept as a draft so you can check it. Submitting sends it to CliniTrack (which forwards the pharmacy return to SHA/DHA) or to SupplyTrack. If a month needs correcting, generate it again and submit: the new version replaces the earlier one.
        </p>
        <div className="row">
          <Field label="Report">
            <select value={kind} onChange={(e) => setKind(e.target.value as Run['kind'])}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Month"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Field label="Facility"><input value={facilityId} onChange={(e) => setFacilityId(e.target.value)} size={10} /></Field>
          <button className="primary" onClick={() => void generate()} disabled={busy || !period || !facilityId}>Generate</button>
        </div>
        <ErrorBox error={error} />
      </div>

      {selected && <RunDetail id={selected} onChange={() => void runs.reload()} onClose={() => setSelected(null)} />}

      <h3>Reports for {facilityId}</h3>
      <ErrorBox error={runs.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Month</th><th>Report</th><th className="right">Version</th><th>Status</th><th>Generated</th><th>Submitted</th><th>Delivery</th></tr></thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => setSelected(r.id)}>{r.period}</button></td>
                <td>{r.kind === 'PHARMACY_RETURN' ? 'Pharmacy return' : 'Stock-outs'}</td>
                <td className="right">{r.version}</td>
                <td><Badge value={r.status} /></td>
                <td className="small">{r.generatedBy}<br />{dateTime(r.generatedAt)}</td>
                <td className="small">{r.submittedBy ? <>{r.submittedBy}<br />{dateTime(r.submittedAt)}</> : '–'}</td>
                <td className="small"><Delivery r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.data && runs.data.length === 0 && <Empty>No reports yet.</Empty>}
      </div>
    </div>
  );
}

function RunDetail({ id, onChange, onClose }: { id: string; onChange: () => void; onClose: () => void }) {
  const { data: r, error: loadError, reload } = useApi<Run>(`/reports/runs/${id}`);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAck(false), [id]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!r) return <div className="card"><ErrorBox error={loadError} />{!loadError && <p className="muted">Loading…</p>}</div>;
  const warnings = r.checks.filter((c) => c.level === 'warning');
  const filename = `${r.kind.toLowerCase()}-${r.facilityId}-${r.period}-v${r.version}.csv`;
  return (
    <div className="card stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <h3>{r.kind === 'PHARMACY_RETURN' ? 'Pharmacy return' : 'Stock-out report'} · {r.facilityId} · {r.period} · version {r.version}</h3>
        <Badge value={r.status} />
        <span className="spacer" />
        <button onClick={() => download(`/reports/runs/${r.id}/csv`, filename).catch((e) => setError((e as Error).message))}>Download CSV</button>
        <button onClick={onClose}>Close</button>
      </div>
      {r.amendsId && <p className="small muted">Replaces an earlier submission for this month.</p>}
      <div className="stats">
        {Object.keys(SUMMARY_LABEL).filter((k) => k in r.summary).map((k) => <span key={k}><strong>{Number(r.summary[k]).toLocaleString()}</strong> {SUMMARY_LABEL[k]}</span>)}
      </div>
      {r.checks.length > 0 && (
        <div className="stack">
          {r.checks.map((c) => (
            <div key={c.code} className={`alert ${c.level === 'warning' ? 'warn' : ''}`}>
              <strong>{c.level === 'warning' ? 'Check' : 'Note'}{c.count ? ` (${c.count})` : ''}:</strong> {c.message}
            </div>
          ))}
        </div>
      )}
      {r.kind === 'PHARMACY_RETURN' && r.data && <ReturnTables data={r.data} />}
      {r.kind === 'STOCK_OUT' && r.data && <StockOutTable rows={r.data.items} />}
      {r.status === 'DRAFT' && (
        <div className="stack">
          {warnings.length > 0 && (
            <label className="row small" style={{ alignItems: 'center' }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I have read the checks above and want to submit anyway.
            </label>
          )}
          <div className="row">
            <button className="primary" disabled={busy || (warnings.length > 0 && !ack)} onClick={() => void act(() => api(`/reports/runs/${r.id}/submit`, { body: { acknowledgeWarnings: ack } }))}>
              Submit to {r.kind === 'PHARMACY_RETURN' ? 'CliniTrack' : 'SupplyTrack'}
            </button>
            <button className="danger" disabled={busy} onClick={() => void act(async () => { await api(`/reports/runs/${r.id}`, { method: 'DELETE' }); onClose(); })}>Discard draft</button>
          </div>
          <p className="small muted">Generated {dateTime(r.generatedAt)} by {r.generatedBy}. Drafts older than a day must be generated again before they can be submitted.</p>
        </div>
      )}
      {r.status !== 'DRAFT' && <p className="small muted">Submitted {dateTime(r.submittedAt)} by {r.submittedBy}. <Delivery r={r} /></p>}
      <ErrorBox error={error} />
    </div>
  );
}

function Delivery({ r }: { r: Run }) {
  if (!r.delivery) return <>–</>;
  if (r.delivery === 'DEAD') return <span><Badge value="DEAD" /> Not delivered. Retry it from <Link href="/integrations">Integrations</Link>.</span>;
  if (r.delivery === 'PENDING') return <span className="muted">Sending…</span>;
  return <span>Delivered{r.externalRef ? <>, reference <span className="mono">{r.externalRef}</span></> : ''}</span>;
}

function ReturnTables({ data }: { data: any }) {
  return (
    <>
      <details>
        <summary>Consumption ({data.consumption.length} products)</summary>
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Drug</th><th>HPT</th><th>ATC</th><th className="right">Quantity</th><th className="right">Refills</th><th className="right">Value</th><th className="right">DDDs</th></tr></thead>
            <tbody>
              {data.consumption.map((c: any) => (
                <tr key={c.hptCode}>
                  <td>{c.genericName} {c.strength}{c.antimicrobial && <> <Badge value="ANTIMICROBIAL" /></>}</td>
                  <td className="mono">{c.hptCode}</td>
                  <td className="mono">{c.atcCode}</td>
                  <td className="right">{c.quantity}</td>
                  <td className="right">{c.refillQuantity}</td>
                  <td className="right">{Number(c.value).toLocaleString()}</td>
                  <td className="right">{c.ddds ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {data.antimicrobials.length > 0 && (
        <details>
          <summary>Antimicrobials by class</summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ATC class</th><th className="right">Quantity</th><th className="right">DDDs</th><th className="right">Products without a DDD</th></tr></thead>
              <tbody>{data.antimicrobials.map((a: any) => <tr key={a.atcClass}><td className="mono">{a.atcClass}</td><td className="right">{a.quantity}</td><td className="right">{a.ddds ?? '–'}</td><td className="right">{a.productsWithoutDdd}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      <p className="small muted">
        Refills: {data.refills.schedulesStarted} schedules started, {data.refills.refillsDispensed} refills dispensed, {data.refills.overdueNow} overdue now.
        {data.adrs.length > 0 && <> ADRs: {data.adrs.map((a: any) => `${a.count} ${label(a.seriousness).toLowerCase()}`).join(', ')}.</>}
        {Object.keys(data.codeSystems ?? {}).length > 0 && <> Code lists: {Object.values(data.codeSystems).join(', ')}.</>}
      </p>
    </>
  );
}

// ── Stock-outs ────────────────────────────────────────────────────────────

function StockOutTable({ rows }: { rows: StockOut[] }) {
  if (!rows.length) return <Empty>No stock-outs in this period.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Item</th><th>HPT</th><th>Store</th><th className="right">Times out</th><th className="right">Days out</th><th className="right">Prescriptions affected</th><th>Now</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={`${s.storeId}|${s.hptCode}`}>
              <td>{s.genericName ? `${s.genericName} ${s.strength ?? ''}` : <span className="muted">Not in drug master</span>}</td>
              <td className="mono">{s.hptCode}</td>
              <td>{s.storeId}</td>
              <td className="right">{s.episodes}</td>
              <td className="right">{s.daysOut}</td>
              <td className="right">{s.prescriptionItemsAffected}</td>
              <td>{s.outAtEnd ? <Badge value="OUT_OF_STOCK" /> : <span className="small muted">Back in stock</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockOutsTab() {
  const { session } = useSession();
  const range = useRange(30);
  const path = `/reports/stock-outs?facilityId=${encodeURIComponent(session.facilityId)}&${range.query}`;
  const { data, error } = useApi<StockOut[]>(path);
  const [dlError, setDlError] = useState<string | null>(null);
  return (
    <div className="stack">
      <p className="small muted">Built from SupplyTrack&apos;s stock-out and restock messages for the stores {session.facilityId} dispenses from. &quot;Prescriptions affected&quot; counts prescription items signed for that item while it was out.</p>
      <div className="row">
        {range.inputs}
        <button onClick={() => download(`${path}&format=csv`, 'stock-outs.csv').catch((e) => setDlError((e as Error).message))}>Download CSV</button>
      </div>
      <ErrorBox error={error ?? dlError} />
      {data && <StockOutTable rows={data} />}
    </div>
  );
}

// ── Refill adherence ──────────────────────────────────────────────────────

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 1000) / 10}%`);

function AdherenceTab() {
  const { session } = useSession();
  const range = useRange(90);
  const [onlyBelow, setOnlyBelow] = useState(false);
  const path = `/reports/adherence?facilityId=${encodeURIComponent(session.facilityId)}&${range.query}`;
  const { data, error } = useApi<AdherenceReport>(path);
  const [dlError, setDlError] = useState<string | null>(null);
  const rows = data ? (onlyBelow ? data.rows.filter((r) => !r.adherent) : data.rows) : [];
  return (
    <div className="stack">
      <p className="small muted">
        Refill timeliness for medicines with refills at {session.facilityId}. Days covered (PDC) is the share of days in the period the patient had supply, counted from the first fill and stopping when the course ends. {data ? pct(data.threshold) : '80%'} or more counts as adherent. A late refill is one collected after the grace days.
      </p>
      <div className="row">
        {range.inputs}
        <label className="row small" style={{ alignItems: 'center' }}><input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} /> Only below {data ? pct(data.threshold) : '80%'}</label>
        <button onClick={() => download(`${path}&format=csv`, 'refill-adherence.csv').catch((e) => setDlError((e as Error).message))}>Download CSV</button>
      </div>
      <ErrorBox error={error ?? dlError} />
      {data && (
        <>
          <div className="card">
            <div className="stats">
              <span><strong>{data.summary.patients}</strong> patients</span>
              <span><strong>{data.summary.items}</strong> medicines on refill</span>
              <span><strong>{pct(data.summary.medianPdc)}</strong> median days covered</span>
              <span><strong>{data.summary.pctAdherent}%</strong> adherent</span>
              <span><strong>{data.summary.lateRefills}</strong> late refills</span>
              <span><strong>{data.summary.overdueNow}</strong> overdue now</span>
            </div>
          </div>
          {rows.length === 0 ? <Empty>{onlyBelow ? 'Every patient is at or above the threshold.' : 'No refills were collected in this period.'}</Empty> : (
            <div className="table-wrap">
              <table aria-label="Adherence by patient">
                <thead><tr><th>Patient</th><th>Medicine</th><th className="right">Fills</th><th className="right">Days covered</th><th className="right">Late refills</th><th className="right">Avg days late</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.scheduleId}>
                      <td><Link href={`/patients/${encodeURIComponent(r.patientId)}`}>{r.patientId}</Link></td>
                      <td><Link href={`/refills/${encodeURIComponent(r.scheduleId)}`}>{r.genericName} {r.strength}</Link></td>
                      <td className="right">{r.fills}</td>
                      <td className="right"><strong>{pct(r.pdc)}</strong> {!r.adherent && <Badge value="BELOW_THRESHOLD" />}</td>
                      <td className="right">{r.lateRefills}</td>
                      <td className="right">{r.fills > 1 ? r.averageDaysLate.toFixed(1) : '–'}</td>
                      <td><Badge value={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Controlled-drug register ──────────────────────────────────────────────

function ControlledTab() {
  const { session } = useSession();
  const range = useRange(30);
  const [storeId, setStoreId] = useState('');
  const [drugId, setDrugId] = useState('');
  const base = `/reports/controlled-drugs?facilityId=${encodeURIComponent(session.facilityId)}&${range.query}${storeId ? `&storeId=${encodeURIComponent(storeId)}` : ''}`;
  const path = `${base}${drugId ? `&drugId=${encodeURIComponent(drugId)}` : ''}`;
  const { data, error } = useApi<Register>(path);
  // Drug choices come from the unfiltered period, so picking one doesn't empty the list.
  const all = useApi<Register>(base);
  const [dlError, setDlError] = useState<string | null>(null);
  return (
    <div className="stack">
      <p className="small muted">
        Every controlled-drug dispense at {session.facilityId}, with who dispensed it and who witnessed it. Quantities are in each drug&apos;s unit of issue. Stock balances are kept in SupplyTrack. Opening this register is recorded in each patient&apos;s access log.
      </p>
      <div className="row">
        {range.inputs}
        <Field label="Store"><input value={storeId} onChange={(e) => setStoreId(e.target.value.trim())} placeholder="All stores" size={12} /></Field>
        <Field label="Drug">
          <select value={drugId} onChange={(e) => setDrugId(e.target.value)}>
            <option value="">All controlled drugs</option>
            {all.data?.totals.map((t) => <option key={t.drugId} value={t.drugId}>{t.genericName} {t.strength}</option>)}
          </select>
        </Field>
        <button onClick={() => download(`${path}&format=csv`, 'controlled-drug-register.csv').catch((e) => setDlError((e as Error).message))}>Download CSV</button>
      </div>
      <ErrorBox error={error ?? dlError} />
      {data && data.truncated && <p className="small">Only the first 5,000 entries are shown. Choose a shorter period or one drug.</p>}
      {data && (data.entries.length === 0 ? <Empty>No controlled drugs were dispensed in this period.</Empty> : (
        <>
          <div className="table-wrap">
            <table aria-label="Totals by drug">
              <thead><tr><th>Drug</th><th>Schedule</th><th className="right">Entries</th><th className="right">Issued</th><th className="right">Returned</th><th className="right">Net</th></tr></thead>
              <tbody>
                {data.totals.map((t) => (
                  <tr key={t.drugId}>
                    <td><strong>{t.genericName}</strong> {t.strength}<div className="small muted mono">{t.hptCode}</div></td>
                    <td><Badge value={t.schedule} /></td>
                    <td className="right">{t.entries}</td>
                    <td className="right">{t.issued} {label(t.unitOfIssue).toLowerCase()}</td>
                    <td className="right">{t.returned}</td>
                    <td className="right"><strong>{t.net}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table aria-label="Register entries">
              <thead><tr><th>Date</th><th>Drug</th><th>Patient</th><th>Prescription</th><th>Batch</th><th className="right">Qty</th><th className="right">Returned</th><th>Dispensed by</th><th>Witness</th><th>Store</th></tr></thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.recordedAt)}</td>
                    <td>{e.genericName} {e.strength}</td>
                    <td><Link href={`/patients/${encodeURIComponent(e.patientId)}`}>{e.patientId}</Link></td>
                    <td><Link href={`/dispensing/${encodeURIComponent(e.orderId)}`} className="mono">{e.prescriptionRef}</Link><div className="small muted">{e.prescriberId}</div></td>
                    <td className="mono">{e.batchNumber}</td>
                    <td className="right">{e.quantity}</td>
                    <td className="right">{e.quantityReturned || ''}</td>
                    <td>{e.dispensedBy}</td>
                    <td>{e.witnessedBy}</td>
                    <td className="mono">{e.storeId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
    </div>
  );
}

// ── Prescribing ───────────────────────────────────────────────────────────

const INDICATORS: [keyof Indicators, string, string][] = [
  ['avgMedicinesPerEncounter', 'Medicines per prescription', ''],
  ['pctEncountersWithAntibiotic', 'With an antibiotic', '%'],
  ['pctEncountersWithInjection', 'With an injection', '%'],
  ['pctItemsOnFormulary', 'Items on formulary', '%'],
  ['pctEncountersWithAntimicrobial', 'With any antimicrobial', '%'],
  ['overridesPer100Items', 'Overrides per 100 items', ''],
];

function PrescribingTab() {
  const { session } = useSession();
  const range = useRange(30);
  const path = `/reports/prescribing?facilityId=${encodeURIComponent(session.facilityId)}&${range.query}`;
  const { data, error } = useApi<Prescribing>(path);
  const [dlError, setDlError] = useState<string | null>(null);
  return (
    <div className="stack">
      <p className="small muted">WHO prescribing indicators from prescriptions signed in CliniTrack. Each prescription counts as one encounter. &quot;On formulary&quot; uses {session.facilityId}&apos;s formulary in place of the essential medicines list.</p>
      <div className="row">
        {range.inputs}
        <button onClick={() => download(`${path}&format=csv`, 'prescribing-indicators.csv').catch((e) => setDlError((e as Error).message))}>Download CSV</button>
      </div>
      <ErrorBox error={error ?? dlError} />
      {data && (
        <>
          <div className="card">
            <div className="stats">
              <span><strong>{data.facility.encounters}</strong> prescriptions</span>
              {INDICATORS.map(([k, l, u]) => <span key={k}><strong>{data.facility[k]}{u}</strong> {l.toLowerCase()}</span>)}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Prescriber</th><th className="right">Prescriptions</th>{INDICATORS.map(([k, l]) => <th key={k} className="right">{l}</th>)}</tr></thead>
              <tbody>
                {data.prescribers.map((p) => (
                  <tr key={p.prescriberId}>
                    <td className="mono">{p.prescriberId}</td>
                    <td className="right">{p.encounters}</td>
                    {INDICATORS.map(([k, , u]) => <td key={k} className="right">{p[k]}{u}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.prescribers.length === 0 && <Empty>No prescriptions in this period.</Empty>}
          </div>
        </>
      )}
    </div>
  );
}

// ── ADRs to PPB ───────────────────────────────────────────────────────────

function AdrTab() {
  const q = useApi<AdrQueue>('/reports/adrs/ppb-queue');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = q.data?.pending ?? [];

  async function exportBatch() {
    setBusy(true);
    setError(null);
    try {
      const batch = await api<unknown>('/reports/adrs/ppb-batch', { body: { adrIds: [...picked] } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ppb-adr-reports-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function markSubmitted(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/adrs/${id}/ppb-submitted`, { body: { ppbReference: refs[id] } });
      setPicked((p) => { const n = new Set(p); n.delete(id); return n; });
      await q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="stack">
      {q.data && (
        <>
          <div className="stats">
            <span><strong>{q.data.counts.pending}</strong> to send</span>
            <span><strong>{q.data.counts.overdue}</strong> overdue</span>
            <span><strong>{q.data.counts.submitted}</strong> sent, awaiting PPB</span>
            <span><strong>{q.data.counts.acknowledged}</strong> acknowledged</span>
          </div>
          <p className="small muted">
            Target: serious reactions within {q.data.targets.serious} days of being recorded, others within {q.data.targets.nonSerious} days. These targets are set for this installation; check them against current PPB guidance. Download the selected reports, submit them to PPB, then record PPB&apos;s reference here.
          </p>
        </>
      )}
      <ErrorBox error={q.error ?? error} />
      <div className="row">
        <button className="primary" disabled={busy || picked.size === 0} onClick={() => void exportBatch()}>Download {picked.size || ''} for PPB</button>
        <button disabled={rows.length === 0} onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>Select all</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th></th><th>Reaction</th><th>Drug</th><th>Patient</th><th>Seriousness</th><th>Recorded</th><th>Due</th><th>PPB reference</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td><input type="checkbox" aria-label={`Select ${a.description}`} checked={picked.has(a.id)} onChange={() => toggle(a.id)} /></td>
                <td>{a.description}</td>
                <td>{a.drug.genericName} {a.drug.strength}</td>
                <td><Link href={`/patients/${encodeURIComponent(a.patientId)}`}>{a.patientId}</Link></td>
                <td>{a.seriousness === 'NON_SERIOUS' ? <span className="small">Non-serious</span> : <><Badge value="SERIOUS" /> <span className="small">{label(a.seriousness.replace(/^SERIOUS_/, ''))}</span></>}</td>
                <td className="small">{dateTime(a.reportedAt)}</td>
                <td>{a.overdue ? <Badge value="OVERDUE" /> : <span className="small">{date(a.dueBy)}</span>}{a.ppbReportStatus === 'EXPORTED' && <div className="small muted">Downloaded</div>}</td>
                <td>
                  <div className="row">
                    <input aria-label="PPB reference" placeholder="Reference" size={12} value={refs[a.id] ?? ''} onChange={(e) => setRefs({ ...refs, [a.id]: e.target.value })} />
                    <button disabled={busy || !refs[a.id]?.trim()} onClick={() => void markSubmitted(a.id)}>Sent</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data && rows.length === 0 && <Empty>Every recorded ADR has been sent to PPB.</Empty>}
      </div>
    </div>
  );
}
