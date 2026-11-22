'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ROLES, useSession } from '../lib/session';

const NAV = [
  { href: '/dispensing', label: 'Dispensing' },
  { href: '/refills', label: 'Refills' },
  { href: '/patients', label: 'Patients' },
  { href: '/formulary', label: 'Formulary' },
];

export function Header() {
  const path = usePathname();
  const { session, setSession } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <header className="top">
      <Link href="/" className="brand">PharmTrack</Link>
      <nav>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={path?.startsWith(n.href) ? 'active' : ''}>
            {n.label}
          </Link>
        ))}
      </nav>
      <button className="session" onClick={() => setOpen(!open)} aria-expanded={open}>
        {session.userId} · {session.role.toLowerCase().replace(/_/g, ' ')} · {session.storeId}
      </button>
      {open && (
        <form
          className="session-panel card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setSession({
              userId: String(f.get('userId')),
              role: String(f.get('role')),
              facilityId: String(f.get('facilityId')),
              storeId: String(f.get('storeId')),
            });
            setOpen(false);
          }}
        >
          <p className="muted small">Development sign-in. SynergyOne SSO replaces this.</p>
          <label>User id<input name="userId" defaultValue={session.userId} required /></label>
          <label>
            Role
            <select name="role" defaultValue={session.role}>
              {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase().replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label>Facility<input name="facilityId" defaultValue={session.facilityId} required /></label>
          <label>Pharmacy store<input name="storeId" defaultValue={session.storeId} required /></label>
          <button className="primary">Save</button>
        </form>
      )}
    </header>
  );
}
