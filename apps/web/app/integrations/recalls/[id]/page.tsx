'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Dl, Empty, ErrorBox } from '../../../../components/ui';
import { api, useApi } from '../../../../lib/api';
import { dateTime, label, recallClass } from '../../../../lib/format';

type Recall = {
  id: string; hptCode: string; batchNumber: string; reason: string; recallClass: string | null; receivedAt: string;
  acknowledgedAt: string | null; acknowledgedBy: string | null;
  drug: { genericName: string; strength: string; dosageForm: string } | null;
  affected: { patientId: string; prescriptionExternalId: string; facilityId: string; dispenseOrderId: string; quantity: number; dispensedAt: string }[];
};

export default function RecallPage() {
  const { id } = useParams<{ id: string }>();
  const { data: r, error, reload } = useApi<Recall>(`/integrations/recalls/${id}`);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <p className="muted">Loading…</p>;
  return (
    <section className="stack">
      <div>
        <Link href="/integrations" className="small">← Integrations</Link>
        <h1>Recall: {r.drug ? `${r.drug.genericName} ${r.drug.strength}` : r.hptCode}, batch {r.batchNumber}</h1>
      </div>
      <div className="card">
        <Dl
          items={[
            ['HPT code', <span key="h" className="mono">{r.hptCode}</span>],
            ['Batch', <span key="b" className="mono">{r.batchNumber}</span>],
            ['Class', r.recallClass ? recallClass(r.recallClass) : '–'],
            ['Reason', r.reason],
            ['Received', dateTime(r.receivedAt)],
            ['Handled', r.acknowledgedAt ? `${r.acknowledgedBy}, ${dateTime(r.acknowledgedAt)}` : 'Not yet'],
          ]}
        />
        <p className="small muted" style={{ marginTop: 12 }}>PharmTrack will not dispense this batch again, even if SupplyTrack still lists it.</p>
      </div>
      <h2>Patients who received this batch ({r.affected.length})</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Patient</th><th>Prescription</th><th className="right">Quantity</th><th>Dispensed</th></tr></thead>
          <tbody>
            {r.affected.map((a) => (
              <tr key={`${a.dispenseOrderId}-${a.patientId}-${a.dispensedAt}`}>
                <td><Link href={`/patients/${encodeURIComponent(a.patientId)}`}>{a.patientId}</Link></td>
                <td><Link href={`/dispensing/${a.dispenseOrderId}`} className="mono">{a.prescriptionExternalId}</Link></td>
                <td className="right">{a.quantity}</td>
                <td>{dateTime(a.dispensedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.affected.length === 0 && <Empty>No patient received this batch.</Empty>}
      </div>
      <ErrorBox error={err} />
      {!r.acknowledgedAt && (
        <div>
          <button
            className="primary"
            onClick={async () => {
              try {
                await api(`/integrations/recalls/${id}/acknowledge`, { body: {} });
                await reload();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Mark as handled
          </button>
        </div>
      )}
    </section>
  );
}
