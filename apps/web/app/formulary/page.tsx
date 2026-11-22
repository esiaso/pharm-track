import { apiGet } from '../../lib/api';

type Drug = {
  id: string; genericName: string; strength: string; dosageForm: string;
  atcCode: string; hptCode: string; formularyStatus: string;
};

export default async function FormularyPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const drugs = (await apiGet<Drug[]>(`/formulary/drugs?q=${encodeURIComponent(q)}`)) ?? [];
  return (
    <section>
      <h1>Formulary</h1>
      <form><input name="q" defaultValue={q} placeholder="Name, ATC or HPT code" /> <button>Search</button></form>
      <table>
        <thead><tr><th>Drug</th><th>Form</th><th>ATC</th><th>HPT</th><th>Status</th></tr></thead>
        <tbody>
          {drugs.map((d) => (
            <tr key={d.id}>
              <td>{d.genericName} {d.strength}</td><td>{d.dosageForm}</td>
              <td>{d.atcCode}</td><td>{d.hptCode}</td><td>{d.formularyStatus}</td>
            </tr>
          ))}
          {drugs.length === 0 && <tr><td colSpan={5} className="muted">No drugs found.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
