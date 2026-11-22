import { apiGet } from '../../lib/api';

type Refill = {
  id: string; patientId: string; status: string; nextDueDate: string | null;
  refillsAuthorised: number; refillsUsed: number;
};

export default async function RefillsPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const { facilityId = '' } = await searchParams;
  const refills = facilityId ? (await apiGet<Refill[]>(`/refills?facilityId=${encodeURIComponent(facilityId)}`)) ?? [] : [];
  return (
    <section>
      <h1>Refills</h1>
      <form><input name="facilityId" defaultValue={facilityId} placeholder="Facility id" /> <button>Load</button></form>
      <table>
        <thead><tr><th>Patient</th><th>Status</th><th>Next due</th><th>Refills left</th></tr></thead>
        <tbody>
          {refills.map((r) => (
            <tr key={r.id}>
              <td>{r.patientId}</td><td>{r.status}</td>
              <td>{r.nextDueDate ? new Date(r.nextDueDate).toLocaleDateString() : '-'}</td>
              <td>{r.refillsAuthorised - r.refillsUsed}</td>
            </tr>
          ))}
          {refills.length === 0 && <tr><td colSpan={4} className="muted">No refills to show.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
