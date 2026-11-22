'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function PatientLookup() {
  const router = useRouter();
  const [id, setId] = useState('');
  return (
    <section className="stack">
      <h1>Patients</h1>
      <p className="muted">Patients are registered in CliniTrack. Enter the CliniTrack patient number to see allergies, medicines and adverse reactions.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (id.trim()) router.push(`/patients/${encodeURIComponent(id.trim())}`); }}>
        <input aria-label="Patient number" placeholder="e.g. PAT-1" value={id} onChange={(e) => setId(e.target.value)} />
        <button className="primary">Open</button>
      </form>
    </section>
  );
}
