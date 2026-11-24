'use client';

import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import { IconAlert, IconArrowRight, IconBook, IconCheck, IconClipboard, IconClock, IconPill, IconRepeat, IconUsers } from '../components/Icons';
import { useApi } from '../lib/api';
import { useSession } from '../lib/session';
import type { Drug, QueueOrder, RefillSummary } from '../lib/types';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function Stat({ icon: I, tone, value, label, href, link }: { icon: Icon; tone: string; value: string; label: string; href: string; link: string }) {
  return (
    <div className="card stat-card">
      <span className={`stat-icon ${tone}`}><I /></span>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        <span>{label}</span>
        <Link href={href}>{link}<IconArrowRight width={14} height={14} /></Link>
      </div>
    </div>
  );
}

const count = (d: unknown[] | null, cap?: number) => (d == null ? '–' : cap && d.length >= cap ? `${cap}+` : String(d.length));

export default function Home() {
  const { session } = useSession();
  const store = encodeURIComponent(session.storeId);
  const facility = encodeURIComponent(session.facilityId);
  const verify = useApi<QueueOrder[]>(`/dispensing/queue?storeId=${store}&status=PENDING,IN_VERIFICATION`);
  const dispense = useApi<QueueOrder[]>(`/dispensing/queue?storeId=${store}&status=VERIFIED,PARTIALLY_DISPENSED`);
  const refills = useApi<RefillSummary>(`/refills/summary?facilityId=${facility}`);
  const drugs = useApi<Drug[]>(`/formulary/drugs?q=&facilityId=${facility}&limit=100`);

  const modules: { href: string; title: string; text: string; icon: Icon; tone: string }[] = [
    { href: '/dispensing', title: 'Dispensing', text: 'Verify prescriptions, dispense from stock, print labels, handle returns.', icon: IconPill, tone: 'violet' },
    { href: '/refills', title: 'Refills', text: 'Due and overdue refills, SMS reminders, refill requests.', icon: IconRepeat, tone: 'ok' },
    { href: '/patients', title: 'Patients', text: 'Allergies, medication history and adverse drug reactions.', icon: IconUsers, tone: 'orange' },
    { href: '/formulary', title: 'Formulary', text: 'Drugs by WHO ATC and PPB HPT code, prices, facility status.', icon: IconBook, tone: 'info' },
  ];

  return (
    <section className="stack">
      <div className="page-head">
        <h1>Overview</h1>
        <p>
          Formulary, medication safety, dispensing and refills for the SynergyOne suite. Prescriptions arrive from
          CliniTrack&apos;s prescription pad, stock comes from SupplyTrack, and billing goes back to CliniTrack.
        </p>
      </div>

      <div className="stat-grid">
        <Stat icon={IconClipboard} tone="violet" value={count(verify.data)} label="To verify" href="/dispensing" link="Queue" />
        <Stat icon={IconCheck} tone="ok" value={count(dispense.data)} label="Ready to dispense" href="/dispensing" link="Queue" />
        <Stat icon={IconClock} tone="orange" value={refills.data ? refills.data.counts.DUE.toLocaleString() : '–'} label="Refills due" href="/refills?status=DUE" link="Refills" />
        <Stat icon={IconAlert} tone="danger" value={refills.data ? refills.data.counts.OVERDUE.toLocaleString() : '–'} label="Refills overdue" href="/refills?status=OVERDUE" link="Refills" />
        <Stat icon={IconBook} tone="info" value={count(drugs.data, 100)} label="Formulary drugs" href="/formulary" link="Formulary" />
      </div>

      <h2 style={{ margin: '8px 0 0' }}>Modules</h2>
      <div className="grid2">
        {modules.map((m) => (
          <Link key={m.href} href={m.href} className="card module-card">
            <span className={`stat-icon ${m.tone}`}><m.icon /></span>
            <div><h3>{m.title}</h3><p className="muted small">{m.text}</p></div>
          </Link>
        ))}
      </div>
    </section>
  );
}
