'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Dl, Empty, ErrorBox } from '../../../components/ui';
import { useApi } from '../../../lib/api';
import { date, dateTime, label, n } from '../../../lib/format';
import type { Notification, RefillSchedule } from '../../../lib/types';

type Detail = RefillSchedule & {
  dispenseOrders: { id: string; kind: string; fillSequence: number; status: string; createdAt: string }[];
  notifications: Notification[];
};
type Adherence = { fills: number; daysOfSupplyPerFill: number; averageDaysLate: number; lateRefills: number; pdc: number | null };

export default function RefillDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: s, error } = useApi<Detail>(`/refills/${id}`);
  const { data: adh } = useApi<Adherence>(`/refills/${id}/adherence`);
  if (error) return <ErrorBox error={error} />;
  if (!s) return <p className="muted">Loading…</p>;
  const item = s.prescriptionItem!;
  return (
    <section className="stack">
      <div>
        <Link href="/refills" className="small">← Refills</Link>
        <h1>{item.drug.genericName} {item.drug.strength} · {s.patientId}</h1>
      </div>
      <div className="card">
        <Dl
          items={[
            ['Status', <Badge key="s" value={s.status} />],
            ['Dose', `${n(item.dose)} ${item.doseUnit} ${item.frequency}`],
            ['Quantity per fill', `${n(item.quantity)} ${item.drug.unitOfIssue.toLowerCase()}`],
            ['Refills used', `${s.refillsUsed} of ${s.refillsAuthorised}`],
            ['Last dispensed', date(s.lastDispensedAt)],
            ['Next due', date(s.nextDueDate)],
            ['Can refill from', date(s.earliestRefillDate)],
            ['Overdue after', `${s.graceDays} days past due`],
            ['Valid until', date(s.expiresAt)],
            ['Days of supply per fill', adh ? String(adh.daysOfSupplyPerFill) : '–'],
            ['Average days late', adh && adh.fills > 1 ? adh.averageDaysLate.toFixed(1) : '–'],
            ['Late refills', adh && adh.fills > 1 ? String(adh.lateRefills) : '–'],
            ['Days covered (PDC)', adh && adh.pdc !== null ? `${Math.round(adh.pdc * 1000) / 10}%` : '–'],
          ]}
        />
      </div>

      <h2>Fills</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Fill</th><th>Status</th><th>Opened</th></tr></thead>
          <tbody>
            {s.dispenseOrders.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/dispensing/${o.id}`}>Refill {o.fillSequence}</Link></td>
                <td><Badge value={o.status} /></td>
                <td>{dateTime(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.dispenseOrders.length === 0 && <Empty>No refills yet. The first fill is on the original prescription.</Empty>}
      </div>

      <h2>SMS sent</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Status</th><th>Message</th><th>When</th></tr></thead>
          <tbody>
            {s.notifications.map((m) => (
              <tr key={m.id}>
                <td>{label(m.purpose)}</td>
                <td><Badge value={m.status} />{m.lastError && <div className="small muted">{m.lastError}</div>}</td>
                <td className="small">{m.body}</td>
                <td>{dateTime(m.sentAt ?? m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.notifications.length === 0 && <Empty>No reminders yet.</Empty>}
      </div>
    </section>
  );
}
