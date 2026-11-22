'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Dl, Empty, ErrorBox, Field } from '../../../components/ui';
import { api, useApi } from '../../../lib/api';
import { date, dateTime, label, n } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import type { Drug } from '../../../lib/types';

type DrugDetail = Drug & { atcHierarchy: string[]; atc: { name: string } };
type Version = { id: string; version: number; changedBy: string; reason: string | null; changedAt: string };
type Price = { id: string; priceListCode: string; unitPrice: string; currency: string; effectiveFrom: string; effectiveTo: string | null };

const STATUSES = ['ACTIVE', 'RESTRICTED', 'NON_FORMULARY', 'DISCONTINUED'];
const RISKS = ['UNKNOWN', 'SAFE', 'CAUTION', 'AVOID', 'CONTRAINDICATED'];

export default function DrugPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const drugRes = useApi<Drug>(`/formulary/drugs/${id}`);
  const detail = useApi<DrugDetail>(drugRes.data ? `/formulary/drugs/by-hpt/${encodeURIComponent(drugRes.data.hptCode)}` : null);
  const versions = useApi<Version[]>(`/formulary/drugs/${id}/versions`);
  const prices = useApi<Price[]>(`/formulary/drugs/${id}/prices`);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = detail.data;
  const canEdit = session.role === 'PHARMACIST' || session.role === 'ADMINISTRATOR';

  async function save(path: string, body: unknown, method: string, msg: string) {
    setError(null);
    setNotice(null);
    try {
      await api(path, { method, body });
      setNotice(msg);
      await Promise.all([drugRes.reload(), detail.reload(), versions.reload(), prices.reload()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (drugRes.error) return <ErrorBox error={drugRes.error} />;
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <section className="stack">
      <div>
        <Link href="/formulary" className="small">← Formulary</Link>
        <h1>{d.genericName} {d.strength} {d.dosageForm.toLowerCase()}</h1>
      </div>
      <ErrorBox error={error} />
      {notice && <div className="notice">{notice}</div>}
      <div className="card">
        <Dl
          items={[
            ['PPB HPT code', <span key="h" className="mono">{d.hptCode}</span>],
            ['WHO ATC code', <span key="a" className="mono">{d.atcCode}</span>],
            ['ATC hierarchy', <span key="ah" className="mono small">{d.atcHierarchy.join(' › ')}</span>],
            ['Brands', d.brandNames.join(', ') || '–'],
            ['Route', label(d.route)],
            ['Pack', `${d.packSize} × ${d.unitOfIssue.toLowerCase()}`],
            ['Status', <Badge key="s" value={d.formularyStatus} />],
            ['Controlled', d.controlledSchedule === 'NONE' ? 'No' : label(d.controlledSchedule)],
            ['Pregnancy', label(d.pregnancyRisk)],
            ['Lactation', label(d.lactationRisk)],
            ['Version', String(d.version)],
          ]}
        />
      </div>

      {canEdit && (
        <div className="grid2">
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
              void save(`/formulary/drugs/${id}`, {
                formularyStatus: f.formularyStatus,
                pregnancyRisk: f.pregnancyRisk,
                lactationRisk: f.lactationRisk,
                brandNames: f.brandNames.split(',').map((s) => s.trim()).filter(Boolean),
                reason: f.reason,
              }, 'PATCH', 'Saved as a new version and sent to CliniTrack.');
            }}
          >
            <h3>Edit drug</h3>
            <Field label="Suite status">
              <select name="formularyStatus" defaultValue={d.formularyStatus}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            </Field>
            <div className="row">
              <Field label="Pregnancy risk"><select name="pregnancyRisk" defaultValue={d.pregnancyRisk}>{RISKS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Lactation risk"><select name="lactationRisk" defaultValue={d.lactationRisk}>{RISKS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
            </div>
            <Field label="Brand names (comma separated)"><input name="brandNames" defaultValue={d.brandNames.join(', ')} /></Field>
            <Field label="Reason for change (kept in version history)"><input name="reason" required minLength={3} /></Field>
            <button className="primary">Save</button>
          </form>

          <div className="stack">
            <form
              className="card stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
                void save(`/formulary/facilities/${encodeURIComponent(session.facilityId)}/drugs/${id}`, {
                  status: f.status,
                  approvalRequiredBy: f.approvalRequiredBy || undefined,
                  restrictionNote: f.restrictionNote || undefined,
                }, 'PUT', `Status at ${session.facilityId} saved.`);
              }}
            >
              <h3>Status at {session.facilityId}</h3>
              <Field label="Status"><select name="status" defaultValue="ACTIVE">{STATUSES.slice(0, 3).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Approval needed from (if restricted)"><input name="approvalRequiredBy" placeholder="e.g. Consultant physician" /></Field>
              <Field label="Note"><input name="restrictionNote" /></Field>
              <button>Save facility status</button>
            </form>

            <form
              className="card stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
                void save(`/formulary/drugs/${id}/prices`, {
                  priceListCode: f.priceListCode,
                  unitPrice: Number(f.unitPrice),
                  effectiveFrom: new Date(f.effectiveFrom).toISOString(),
                }, 'POST', 'Price saved and sent to CliniTrack.');
              }}
            >
              <h3>New price</h3>
              <div className="row">
                <Field label="Price list"><select name="priceListCode"><option value="DEFAULT">Default</option><option value="SHA">SHA</option></select></Field>
                <Field label="Unit price (KES)"><input name="unitPrice" type="number" step="0.01" min="0.01" required style={{ width: 110 }} /></Field>
                <Field label="From"><input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
              </div>
              <button>Add price</button>
            </form>
          </div>
        </div>
      )}

      <h2>Prices</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>List</th><th className="right">Unit price</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            {prices.data?.map((p) => (
              <tr key={p.id}><td>{p.priceListCode}</td><td className="right">{p.currency} {n(p.unitPrice).toFixed(2)}</td><td>{date(p.effectiveFrom)}</td><td>{date(p.effectiveTo)}</td></tr>
            ))}
          </tbody>
        </table>
        {prices.data?.length === 0 && <Empty>No prices yet. Dispensing bills at 0 until one is set.</Empty>}
      </div>

      <h2>Version history</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Version</th><th>Changed by</th><th>Reason</th><th>When</th></tr></thead>
          <tbody>
            {versions.data?.map((v) => (
              <tr key={v.id}><td>{v.version}</td><td>{v.changedBy}</td><td>{v.reason ?? '–'}</td><td>{dateTime(v.changedAt)}</td></tr>
            ))}
          </tbody>
        </table>
        {versions.error && <Empty>Version history needs the pharmacist role.</Empty>}
      </div>
    </section>
  );
}
