'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Empty, ErrorBox } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { date } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { DispenseOrder, RefillSchedule, RefillSummary } from '../../lib/types';

const PAGE = 100;
const STATUSES = ['DUE', 'OVERDUE', 'UPCOMING', 'COMPLETED', 'EXPIRED', 'CANCELLED'] as const;

export default function RefillsPage() {
  const { session } = useSession();
  const [status, setStatus] = useState('');
  const [patient, setPatient] = useState('');
  const [page, setPage] = useState(0);
  // The overview links here with ?status=DUE or ?status=OVERDUE.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s && (STATUSES as readonly string[]).includes(s)) setStatus(s);
  }, []);
  useEffect(() => setPage(0), [status, patient, session.facilityId]);
  const facility = encodeURIComponent(session.facilityId);
  const { data, error, loading, reload } = useApi<RefillSchedule[]>(
    `/refills?facilityId=${facility}${status ? `&status=${status}` : ''}${patient ? `&patientId=${encodeURIComponent(patient)}` : ''}&limit=${PAGE}&offset=${page * PAGE}`,
  );
  const summary = useApi<RefillSummary>(`/refills/summary?facilityId=${facility}`);
  // Totals come from the summary; a patient search is short enough to count directly.
  const total = patient ? (data?.length ?? 0) + page * PAGE : summary.data ? (status ? summary.data.counts[status as keyof RefillSummary['counts']] : summary.data.open) : null;
  const pages = total === null ? null : Math.max(1, Math.ceil(total / PAGE));
  const [actionError, setActionError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, string>>({});

  async function request(id: string) {
    setActionError(null);
    try {
      const order = await api<DispenseOrder>(`/refills/${id}/request`, { body: { storeId: session.storeId } });
      setOpened({ ...opened, [id]: order.id });
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <section>
      <div className="row">
        <h1>Refills</h1>
        <span className="spacer" />
        <span className="muted small">Facility {session.facilityId}</span>
        <input aria-label="Patient id" placeholder="Patient id" size={12} defaultValue="" onKeyDown={(e) => e.key === 'Enter' && setPatient(e.currentTarget.value.trim())} onBlur={(e) => setPatient(e.currentTarget.value.trim())} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Open (upcoming, due, overdue){summary.data ? ` · ${summary.data.open.toLocaleString()}` : ''}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}{summary.data ? ` · ${summary.data.counts[s].toLocaleString()}` : ''}</option>
          ))}
        </select>
        <button onClick={() => { void reload(); void summary.reload(); }} disabled={loading}>Refresh</button>
      </div>
      <p className="muted small">Reminder SMS go out at 7:00 AM: three days before the due date, on the due date, and once overdue, to patients who opted in.</p>
      <ErrorBox error={error ?? actionError} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Patient</th><th>Medicine</th><th>Status</th><th>Next due</th><th>Can refill from</th><th className="right">Refills left</th><th>Valid until</th><th /></tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/patients/${encodeURIComponent(r.patientId)}`}>{r.patientId}</Link></td>
                <td><Link href={`/refills/${r.id}`}>{r.prescriptionItem?.drug.genericName} {r.prescriptionItem?.drug.strength}</Link></td>
                <td><Badge value={r.status} /></td>
                <td>{r.nextDueDate ? date(r.nextDueDate) : <span className="muted">After first fill</span>}</td>
                <td>{date(r.earliestRefillDate)}</td>
                <td className="right">{r.refillsAuthorised - r.refillsUsed} of {r.refillsAuthorised}</td>
                <td>{date(r.expiresAt)}</td>
                <td>
                  {opened[r.id] ? (
                    <Link href={`/dispensing/${opened[r.id]}`}>Open order →</Link>
                  ) : (
                    r.lastDispensedAt && ['DUE', 'OVERDUE', 'UPCOMING'].includes(r.status) && <button onClick={() => request(r.id)}>Start refill</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <Empty>No refills to show.</Empty>}
      </div>
      {data && (page > 0 || data.length === PAGE) && (
        <div className="row pager">
          <span className="muted small">
            Showing {(page * PAGE + 1).toLocaleString()} to {(page * PAGE + data.length).toLocaleString()}
            {!patient && total !== null ? ` of ${total.toLocaleString()}` : ''}
          </span>
          <span className="spacer" />
          <button onClick={() => { setPage(page - 1); window.scrollTo(0, 0); }} disabled={page === 0 || loading}>Previous</button>
          <span className="small">Page {page + 1}{pages && !patient ? ` of ${pages.toLocaleString()}` : ''}</span>
          <button onClick={() => { setPage(page + 1); window.scrollTo(0, 0); }} disabled={data.length < PAGE || loading}>Next</button>
        </div>
      )}
    </section>
  );
}
