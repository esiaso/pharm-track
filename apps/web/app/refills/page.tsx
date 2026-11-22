'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { date } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { DispenseOrder, RefillSchedule } from '../../lib/types';

export default function RefillsPage() {
  const { session } = useSession();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<RefillSchedule[]>(
    `/refills?facilityId=${encodeURIComponent(session.facilityId)}${status ? `&status=${status}` : ''}`,
  );
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
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Open (upcoming, due, overdue)</option>
          <option value="DUE">Due</option>
          <option value="OVERDUE">Overdue</option>
          <option value="UPCOMING">Upcoming</option>
          <option value="COMPLETED">Completed</option>
          <option value="EXPIRED">Expired</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button onClick={() => reload()} disabled={loading}>Refresh</button>
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
    </section>
  );
}
