'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { dateTime, label, recallClass } from '../../lib/format';
import { hasRole, useSession } from '../../lib/session';

type Summary = {
  outbox: { destination: string; status: string; count: number }[];
  oldestPendingAt: string | null;
  sms: { status: string; count: number }[];
  openRecalls: number;
  itemsOutOfStock: number;
};
type OutboxEvent = { id: string; type: string; destination: string; status: string; attempts: number; lastError: string | null; createdAt: string; nextAttemptAt: string; deliveredAt: string | null; idempotencyKey: string };
type Recall = { id: string; hptCode: string; batchNumber: string; reason: string; recallClass: string | null; receivedAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null };
type StockAlert = { id: string; storeId: string; hptCode: string; status: string; quantity: string | null; updatedAt: string };

const count = (s: Summary | null, dest: string, status: string) => s?.outbox.find((o) => o.destination === dest && o.status === status)?.count ?? 0;

export default function IntegrationsPage() {
  const { session } = useSession();
  const [status, setStatus] = useState('DEAD');
  const summary = useApi<Summary>('/integrations/summary');
  const outbox = useApi<OutboxEvent[]>(`/integrations/outbox${status ? `?status=${status}` : ''}`);
  const recalls = useApi<Recall[]>('/integrations/recalls');
  const stock = useApi<StockAlert[]>(`/integrations/stock-alerts?storeId=${encodeURIComponent(session.storeId)}`);
  const [error, setError] = useState<string | null>(null);
  const s = summary.data;

  async function retry(id: string) {
    setError(null);
    try {
      await api(`/integrations/outbox/${id}/retry`, { body: {} });
      await Promise.all([outbox.reload(), summary.reload()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="stack">
      <div className="row">
        <h1>Integrations</h1>
        <span className="spacer" />
        <button onClick={() => { void summary.reload(); void outbox.reload(); void recalls.reload(); void stock.reload(); }}>Refresh</button>
      </div>
      <ErrorBox error={summary.error ?? error} />

      <div className="grid2">
        {(['CLINITRACK', 'SUPPLYTRACK'] as const).map((d) => (
          <div key={d} className="card">
            <h3>{d === 'CLINITRACK' ? 'To CliniTrack' : 'To SupplyTrack'}</h3>
            <p className="muted small">{d === 'CLINITRACK' ? 'Billing, prices, drug updates, allergies' : 'Stock deductions and returns'}</p>
            <div className="row">
              <span><strong>{count(s, d, 'PENDING')}</strong> waiting</span>
              <span><strong>{count(s, d, 'DEAD')}</strong> failed</span>
              <span className="muted">{count(s, d, 'DELIVERED')} delivered</span>
            </div>
          </div>
        ))}
        <div className="card">
          <h3>Patient SMS</h3>
          <div className="row">
            {(s?.sms ?? []).map((g) => <span key={g.status}><strong>{g.count}</strong> {label(g.status).toLowerCase()}</span>)}
            {s && s.sms.length === 0 && <span className="muted">None yet</span>}
          </div>
        </div>
        <div className="card">
          <h3>From SupplyTrack</h3>
          <div className="row">
            <span><strong>{s?.openRecalls ?? 0}</strong> open recalls</span>
            <span><strong>{s?.itemsOutOfStock ?? 0}</strong> items out of stock</span>
          </div>
        </div>
      </div>
      {s?.oldestPendingAt && <p className="small muted">Oldest waiting message queued {dateTime(s.oldestPendingAt)}. Messages retry with backoff for about a day before they are marked failed.</p>}

      <h2>Batch recalls</h2>
      <ErrorBox error={recalls.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Batch</th><th>Reason</th><th>Class</th><th>Received</th><th>Status</th></tr></thead>
          <tbody>
            {recalls.data?.map((r) => (
              <tr key={r.id}>
                <td className="mono"><Link href={`/integrations/recalls/${r.id}`}>{r.hptCode}</Link></td>
                <td className="mono">{r.batchNumber}</td>
                <td>{r.reason}</td>
                <td>{r.recallClass ? recallClass(r.recallClass) : '–'}</td>
                <td>{dateTime(r.receivedAt)}</td>
                <td>{r.acknowledgedAt ? <span className="small muted">Handled by {r.acknowledgedBy}</span> : <Badge value="OPEN_RECALL" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recalls.data?.length === 0 && <Empty>No recalls.</Empty>}
      </div>

      <h2>Stock alerts · {session.storeId}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Status</th><th className="right">Quantity</th><th>Updated</th></tr></thead>
          <tbody>
            {stock.data?.map((a) => (
              <tr key={a.id}><td className="mono">{a.hptCode}</td><td><Badge value={a.status === 'OUT' ? 'OUT_OF_STOCK' : 'LOW_STOCK'} /></td><td className="right">{a.quantity ?? '–'}</td><td>{dateTime(a.updatedAt)}</td></tr>
            ))}
          </tbody>
        </table>
        {stock.data?.length === 0 && <Empty>No stock alerts for this store.</Empty>}
      </div>

      <div className="row">
        <h2>Outgoing messages</h2>
        <span className="spacer" />
        <select aria-label="Message status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="DEAD">Failed</option>
          <option value="PENDING">Waiting</option>
          <option value="DELIVERED">Delivered</option>
          <option value="">All</option>
        </select>
      </div>
      <ErrorBox error={outbox.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Message</th><th>To</th><th>Status</th><th className="right">Attempts</th><th>Last error</th><th>Queued</th><th /></tr></thead>
          <tbody>
            {outbox.data?.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.type}</td>
                <td>{e.destination === 'CLINITRACK' ? 'CliniTrack' : 'SupplyTrack'}</td>
                <td><Badge value={e.status} /></td>
                <td className="right">{e.attempts}</td>
                <td className="small">{e.lastError ?? '–'}{e.status === 'PENDING' && e.attempts > 0 && <div className="muted">Next try {dateTime(e.nextAttemptAt)}</div>}</td>
                <td>{dateTime(e.createdAt)}</td>
                <td>{e.status !== 'DELIVERED' && hasRole(session, 'ADMINISTRATOR') && <button onClick={() => retry(e.id)}>Retry now</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {outbox.data?.length === 0 && <Empty>{status === 'DEAD' ? 'No failed messages.' : 'Nothing to show.'}</Empty>}
      </div>
    </section>
  );
}
