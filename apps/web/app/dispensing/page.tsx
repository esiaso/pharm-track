'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '../../components/ui';
import { useApi } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { QueueOrder } from '../../lib/types';

const VIEWS: Record<string, string> = {
  open: 'PENDING,IN_VERIFICATION,VERIFIED,PARTIALLY_DISPENSED',
  verify: 'PENDING,IN_VERIFICATION',
  dispense: 'VERIFIED,PARTIALLY_DISPENSED',
  done: 'DISPENSED,RETURNED,CANCELLED',
};

export default function DispensingQueue() {
  const { session } = useSession();
  const router = useRouter();
  const [view, setView] = useState('open');
  const { data, error, loading, reload } = useApi<QueueOrder[]>(
    `/dispensing/queue?storeId=${encodeURIComponent(session.storeId)}&status=${VIEWS[view]}`,
  );
  return (
    <section>
      <div className="row">
        <h1>Dispensing queue</h1>
        <span className="spacer" />
        <span className="muted small">Store {session.storeId}</span>
        <button onClick={() => reload()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div className="row" role="tablist" style={{ marginBottom: 12 }}>
        {[['open', 'All open'], ['verify', 'To verify'], ['dispense', 'To dispense'], ['done', 'Completed']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'primary' : ''} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Priority</th><th>Patient</th><th>Prescription</th><th>Fill</th><th>Prescriber</th><th>Status</th><th>Received</th></tr>
          </thead>
          <tbody>
            {data?.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => router.push(`/dispensing/${o.id}`)}>
                <td><Badge value={o.priority} /></td>
                <td><a href={`/dispensing/${o.id}`} onClick={(e) => e.preventDefault()}>{o.prescription.patientId}</a></td>
                <td className="mono">{o.prescription.externalId}</td>
                <td>{o.kind === 'REFILL' ? `Refill ${o.fillSequence}` : 'First fill'}</td>
                <td>{o.prescription.prescriberId}</td>
                <td><Badge value={o.status} /></td>
                <td>{dateTime(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <Empty>Nothing here for store {session.storeId}.</Empty>}
      </div>
    </section>
  );
}
