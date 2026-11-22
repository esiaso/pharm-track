import { apiGet } from '../../lib/api';

type Order = { id: string; kind: string; fillSequence: number; priority: string; status: string; createdAt: string };

export default async function DispensingPage({ searchParams }: { searchParams: Promise<{ storeId?: string }> }) {
  const { storeId = '' } = await searchParams;
  const orders = storeId ? (await apiGet<Order[]>(`/dispensing/queue?storeId=${encodeURIComponent(storeId)}`)) ?? [] : [];
  return (
    <section>
      <h1>Dispensing queue</h1>
      <form><input name="storeId" defaultValue={storeId} placeholder="Pharmacy store id" /> <button>Load</button></form>
      <table>
        <thead><tr><th>Order</th><th>Fill</th><th>Priority</th><th>Status</th><th>Received</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.id.slice(0, 8)}</td><td>{o.kind === 'REFILL' ? `Refill ${o.fillSequence}` : 'Initial'}</td>
              <td>{o.priority}</td><td>{o.status}</td><td>{new Date(o.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={5} className="muted">Nothing in the queue.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
