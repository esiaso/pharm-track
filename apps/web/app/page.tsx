import Link from 'next/link';

export default function Home() {
  return (
    <section className="stack">
      <h1>PharmTrack</h1>
      <p className="muted">
        Formulary, medication safety, dispensing and refills for the SynergyOne suite. Prescriptions arrive from
        CliniTrack&apos;s prescription pad, stock comes from SupplyTrack, and billing goes back to CliniTrack.
      </p>
      <div className="grid2">
        <Link href="/dispensing" className="card"><h3>Dispensing</h3><p className="muted small">Verify prescriptions, dispense from stock, print labels, handle returns.</p></Link>
        <Link href="/refills" className="card"><h3>Refills</h3><p className="muted small">Due and overdue refills, SMS reminders, refill requests.</p></Link>
        <Link href="/patients" className="card"><h3>Patients</h3><p className="muted small">Allergies, medication history and adverse drug reactions.</p></Link>
        <Link href="/formulary" className="card"><h3>Formulary</h3><p className="muted small">Drugs by WHO ATC and PPB HPT code, prices, facility status.</p></Link>
      </div>
    </section>
  );
}
