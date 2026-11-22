'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '../../components/ui';
import { useApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { Drug } from '../../lib/types';

export default function FormularyPage() {
  const { session } = useSession();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [inactive, setInactive] = useState(false);
  const { data, error, loading } = useApi<Drug[]>(
    `/formulary/drugs?q=${encodeURIComponent(term)}&facilityId=${encodeURIComponent(session.facilityId)}&limit=100${inactive ? '&includeInactive=true' : ''}`,
  );
  return (
    <section>
      <h1>Formulary</h1>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setTerm(q); }}>
        <input aria-label="Search" placeholder="Name, brand, ATC code or class, HPT code" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 260px' }} />
        <button className="primary">{loading ? 'Searching…' : 'Search'}</button>
        <label className="row small muted"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Include discontinued</label>
      </form>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Drug</th><th>Form / route</th><th>WHO ATC</th><th>PPB HPT</th><th>Suite status</th><th>At {session.facilityId}</th></tr>
          </thead>
          <tbody>
            {data?.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/formulary/${d.id}`}>{d.genericName} {d.strength}</Link>
                  {d.brandNames.length > 0 && <div className="small muted">{d.brandNames.join(', ')}</div>}
                  {d.controlledSchedule !== 'NONE' && <Badge value="CONTROLLED" />}
                </td>
                <td>{d.dosageForm.toLowerCase()} · {d.route.toLowerCase()}</td>
                <td className="mono">{d.atcCode}</td>
                <td className="mono">{d.hptCode}</td>
                <td><Badge value={d.formularyStatus} /></td>
                <td>{d.facilityStatus ? <Badge value={d.facilityStatus} /> : <span className="muted small">Suite default</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <Empty>No drugs match.</Empty>}
      </div>
    </section>
  );
}
