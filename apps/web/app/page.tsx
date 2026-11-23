import Link from 'next/link';
import { Icon, IconName } from '../components/icons';

const TILES: { href: string; title: string; icon: IconName; text: string }[] = [
  { href: '/dispensing', title: 'Dispensing', icon: 'pill', text: 'Verify prescriptions, dispense from stock, print labels, handle returns.' },
  { href: '/refills', title: 'Refills', icon: 'refresh', text: 'Due and overdue refills, SMS reminders, refill requests.' },
  { href: '/patients', title: 'Patients', icon: 'users', text: 'Allergies, medication history and adverse drug reactions.' },
  { href: '/formulary', title: 'Formulary', icon: 'book', text: 'Drugs by WHO ATC and PPB HPT code, prices, facility status.' },
];

export default function Home() {
  return (
    <section className="stack">
      <div className="card">
        <h1 style={{ marginBottom: 6 }}>Welcome to PharmTrack</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
          Formulary, medication safety, dispensing and refills for the SynergyOne suite. Prescriptions arrive from
          CliniTrack&apos;s prescription pad, stock comes from SupplyTrack, and billing goes back to CliniTrack.
        </p>
      </div>
      <div className="grid2">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="card tile">
            <span className="tile-icon"><Icon name={t.icon} size={22} /></span>
            <span>
              <h3>{t.title}</h3>
              <p className="muted small">{t.text}</p>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
