'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { hasRole, ROLES, useSession } from '../lib/session';

const NAV = [
  { href: '/dispensing', label: 'Dispensing' },
  { href: '/refills', label: 'Refills' },
  { href: '/patients', label: 'Patients' },
  { href: '/formulary', label: 'Formulary' },
  { href: '/content', label: 'Clinical content', roles: ['PHARMACIST'] },
  { href: '/integrations', label: 'Integrations', roles: ['PHARMACIST'] },
];

export function Header() {
  const path = usePathname();
  const { session, setSession, status, signOut } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <header className="top">
      <Link href="/" className="brand">PharmTrack</Link>
      {status === 'ready' && (
        <nav>
          {NAV.filter((n) => !n.roles || hasRole(session, ...n.roles)).map((n) => (
            <Link key={n.href} href={n.href} className={path?.startsWith(n.href) ? 'active' : ''}>
              {n.label}
            </Link>
          ))}
        </nav>
      )}
      {status === 'ready' && (
        <button className="session" onClick={() => setOpen(!open)} aria-expanded={open}>
          {session.userId} · {session.role.toLowerCase().replace(/_/g, ' ')} · {session.storeId}
        </button>
      )}
      {open && (
        <form
          className="session-panel card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const patch: Record<string, string | string[]> = { facilityId: String(f.get('facilityId')), storeId: String(f.get('storeId')) };
            if (!session.sso) {
              patch.userId = String(f.get('userId'));
              patch.role = String(f.get('role'));
              patch.roles = [String(f.get('role'))];
            }
            setSession(patch);
            setOpen(false);
          }}
        >
          {session.sso ? (
            <p className="small">Signed in through SynergyOne as <strong>{session.userId}</strong> ({session.roles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ') || 'no PharmTrack role'}).</p>
          ) : (
            <>
              <p className="muted small">Development sign-in. Set the NEXT_PUBLIC_SSO_* settings to use SynergyOne SSO.</p>
              <label>User id<input name="userId" defaultValue={session.userId} required /></label>
              <label>
                Role
                <select name="role" defaultValue={session.role}>
                  {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase().replace(/_/g, ' ')}</option>)}
                </select>
              </label>
            </>
          )}
          <label>Facility<input name="facilityId" defaultValue={session.facilityId} required /></label>
          <label>Pharmacy store<input name="storeId" defaultValue={session.storeId} required /></label>
          <div className="row">
            <button className="primary">Save</button>
            {session.sso && <button type="button" onClick={signOut}>Sign out</button>}
          </div>
        </form>
      )}
    </header>
  );
}

/** Shows the sign-in screen when SSO is on and nobody is signed in. */
export function SessionGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { status, signIn } = useSession();
  if (path?.startsWith('/auth/')) return <>{children}</>;
  if (status === 'loading') return <p className="muted">Loading…</p>;
  if (status === 'signed-out')
    return (
      <section className="card stack" style={{ maxWidth: 420, margin: '48px auto' }}>
        <h1 style={{ margin: 0 }}>Sign in to PharmTrack</h1>
        <p className="muted" style={{ margin: 0 }}>Use your SynergyOne account.</p>
        <button className="primary" onClick={signIn}>Sign in with SynergyOne</button>
      </section>
    );
  return <>{children}</>;
}
