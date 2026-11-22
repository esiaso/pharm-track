export default function Home() {
  return (
    <section>
      <h1>PharmTrack</h1>
      <p className="muted">
        Formulary, medication safety, dispensing and refills for the SynergyOne suite. The
        prescription pad and billing live in CliniTrack; stock lives in SupplyTrack.
      </p>
      <ul>
        <li><a href="/formulary">Formulary</a>: drugs by WHO ATC and PPB HPT code</li>
        <li><a href="/dispensing">Dispensing queue</a>: verify and dispense signed prescriptions</li>
        <li><a href="/refills">Refills</a>: due and overdue refills, SMS reminders</li>
      </ul>
    </section>
  );
}
