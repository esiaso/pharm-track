'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ComponentType, ReactNode, SVGProps, useEffect, useRef, useState } from 'react';
import { hasRole, ROLES, useSession } from '../lib/session';
import {
  IconBook, IconChart, IconChevronDown, IconClose, IconFlask, IconHome, IconMenu, IconMoon, IconPanel, IconPill,
  IconPlug, IconRepeat, IconSearch, IconSettings, IconShield, IconSun, IconUsers, Logo,
} from './Icons';

type NavItem = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; roles?: string[] };

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main menu',
    items: [
      { href: '/', label: 'Overview', icon: IconHome },
      { href: '/dispensing', label: 'Dispensing', icon: IconPill },
      { href: '/refills', label: 'Refills', icon: IconRepeat },
      { href: '/patients', label: 'Patients', icon: IconUsers },
      { href: '/formulary', label: 'Formulary', icon: IconBook },
    ],
  },
  {
    title: 'Management',
    items: [
      { href: '/reports', label: 'Reports', icon: IconChart, roles: ['PHARMACIST'] },
      { href: '/content', label: 'Clinical content', icon: IconFlask, roles: ['PHARMACIST'] },
      { href: '/integrations', label: 'Integrations', icon: IconPlug, roles: ['PHARMACIST'] },
      { href: '/privacy', label: 'Data protection', icon: IconShield, roles: ['ADMINISTRATOR'] },
      { href: '/settings', label: 'Settings', icon: IconSettings, roles: ['ADMINISTRATOR', 'PHARMACIST'] },
    ],
  },
];

const roleLabel = (r: string) => r.toLowerCase().replace(/_/g, ' ');
const isActive = (path: string | null, href: string) => (href === '/' ? path === '/' : !!path?.startsWith(href));

/** Sidebar, top bar and the rounded content panel around every page. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setMenuOpen(false), [path]);
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onCollapse={() => setCollapsed(!collapsed)} />
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <div className="panel">
        <Topbar onMenu={() => setMenuOpen(true)} onExpand={collapsed ? () => setCollapsed(false) : undefined} />
        <main className="content">
          <SessionGate>{children}</SessionGate>
        </main>
      </div>
    </div>
  );
}

function useNav() {
  const { session, status } = useSession();
  if (status !== 'ready') return [];
  return NAV.map((g) => ({ ...g, items: g.items.filter((n) => !n.roles || hasRole(session, ...n.roles)) })).filter((g) => g.items.length);
}

function Sidebar({ open, onClose, onCollapse }: { open: boolean; onClose: () => void; onCollapse: () => void }) {
  const path = usePathname();
  const groups = useNav();
  const { session, status } = useSession();
  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-head">
        <Link href="/" className="brand"><Logo size={30} /><span>Pharm<b>Track</b></span></Link>
        <button className="icon-btn ghost hide-mobile" onClick={onCollapse} aria-label="Collapse sidebar"><IconPanel /></button>
        <button className="icon-btn ghost show-mobile" onClick={onClose} aria-label="Close menu"><IconClose /></button>
      </div>
      <nav className="sidebar-nav">
        {groups.map((g) => (
          <div key={g.title} className="nav-group">
            <p className="nav-title">{g.title}</p>
            <ul>
              {g.items.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={`nav-item${isActive(path, n.href) ? ' active' : ''}`} aria-current={isActive(path, n.href) ? 'page' : undefined}>
                    <n.icon /><span>{n.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {status === 'ready' && (
        <div className="sidebar-foot">
          <p className="nav-title">Working in</p>
          <p className="foot-store"><strong>{session.storeId}</strong><span>Facility {session.facilityId}</span></p>
        </div>
      )}
    </aside>
  );
}

function Topbar({ onMenu, onExpand }: { onMenu: () => void; onExpand?: () => void }) {
  return (
    <header className="topbar">
      <button className="icon-btn ghost show-mobile" onClick={onMenu} aria-label="Open menu"><IconMenu /></button>
      {onExpand && <button className="icon-btn ghost hide-mobile" onClick={onExpand} aria-label="Expand sidebar"><IconPanel /></button>}
      <Link href="/" className="brand show-mobile"><Logo size={26} /></Link>
      <PageSearch />
      <span className="spacer" />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}

/** Jump to a page by name; Ctrl/⌘ K focuses it. */
function PageSearch() {
  const router = useRouter();
  const groups = useNav();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const items = groups.flatMap((g) => g.items).filter((n) => n.label.toLowerCase().includes(q.trim().toLowerCase()));
  const go = (href: string) => { setQ(''); ref.current?.blur(); router.push(href); };
  return (
    <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); if (items[0]) go(items[0].href); }}>
      <IconSearch />
      <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" aria-label="Search pages"
        onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
      <kbd>⌘ K</kbd>
      {focus && q && (
        <ul className="search-results card">
          {items.length === 0 && <li className="muted small">No page called “{q}”.</li>}
          {items.map((n) => (
            <li key={n.href}><button type="button" onMouseDown={() => go(n.href)}><n.icon />{n.label}</button></li>
          ))}
        </ul>
      )}
    </form>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('pt-theme', next); } catch { /* private mode */ }
    setDark(!dark);
  };
  return (
    <button className="icon-btn" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function UserMenu() {
  const { session, setSession, status, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (status !== 'ready') return null;
  const initials = session.userId.replace(/[^a-z0-9]/gi, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div className="user" ref={box}>
      <button className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog">
        <span className="avatar">{initials}</span>
        <span className="user-text hide-mobile"><strong>{session.userId}</strong><span>{roleLabel(session.role)}</span></span>
        <IconChevronDown className="hide-mobile" />
      </button>
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
          <div className="session-head">
            <span className="avatar lg">{initials}</span>
            <div><strong>{session.userId}</strong><p className="muted small">{roleLabel(session.role)} · {session.storeId}</p></div>
          </div>
          {session.sso ? (
            <p className="small">Signed in through SynergyOne as <strong>{session.userId}</strong> ({session.roles.map(roleLabel).join(', ') || 'no PharmTrack role'}).</p>
          ) : (
            <>
              <p className="muted small">Development sign-in. Set the NEXT_PUBLIC_SSO_* settings to use SynergyOne SSO.</p>
              <label>User id<input name="userId" defaultValue={session.userId} required /></label>
              <label>
                Role
                <select name="role" defaultValue={session.role}>
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
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
    </div>
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
      <section className="card stack signin">
        <Logo size={40} />
        <h1>Sign in to PharmTrack</h1>
        <p className="muted">Use your SynergyOne account.</p>
        <button className="primary" onClick={signIn}>Sign in with SynergyOne</button>
      </section>
    );
  return <>{children}</>;
}
