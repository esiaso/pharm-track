'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { hasRole, ROLES, useSession } from '../lib/session';
import { THEME_KEY } from '../lib/theme';
import { Icon, IconName } from './icons';

type NavItem = { href: string; label: string; icon: IconName; roles?: string[]; hint: string };

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Pharmacy',
    items: [
      { href: '/', label: 'Overview', icon: 'home', hint: 'Start page' },
      { href: '/dispensing', label: 'Dispensing', icon: 'pill', hint: 'Queue, verification, labels, returns' },
      { href: '/refills', label: 'Refills', icon: 'refresh', hint: 'Due and overdue refills, SMS' },
      { href: '/patients', label: 'Patients', icon: 'users', hint: 'Allergies, history, ADRs' },
      { href: '/formulary', label: 'Formulary', icon: 'book', hint: 'Drugs, codes, prices' },
    ],
  },
  {
    title: 'Management',
    items: [
      { href: '/reports', label: 'Reports', icon: 'chart', roles: ['PHARMACIST'], hint: 'Registers, returns, stock' },
      { href: '/content', label: 'Clinical content', icon: 'shield', roles: ['PHARMACIST'], hint: 'Code lists and rule sets' },
      { href: '/integrations', label: 'Integrations', icon: 'plug', roles: ['PHARMACIST'], hint: 'CliniTrack and SupplyTrack outbox' },
      { href: '/privacy', label: 'Data protection', icon: 'lock', roles: ['ADMINISTRATOR'], hint: 'Access log, export, retention' },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.items);
const isActive = (path: string | null, href: string) => (href === '/' ? path === '/' : !!path?.startsWith(href));
const roleLabel = (r: string) => r.toLowerCase().replace(/_/g, ' ');

/** Sidebar, top bar and page area. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { session, status } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [path]);
  const ready = status === 'ready';
  const visible = (n: NavItem) => !n.roles || hasRole(session, ...n.roles);
  const current = ALL.find((n) => n.href !== '/' && isActive(path, n.href));

  return (
    <div className="shell">
      <aside className={`sidebar no-print${navOpen ? ' open' : ''}`} aria-label="Main menu">
        <div className="sidebar-head">
          <Link href="/" className="brand">
            <span className="brand-mark"><Icon name="pill" size={18} /></span>
            PharmTrack
          </Link>
          <button className="icon-btn sidebar-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
        </div>
        {ready && (
          <nav>
            {GROUPS.map((g) => {
              const items = g.items.filter(visible);
              if (!items.length) return null;
              return (
                <div key={g.title} className="nav-group">
                  <p className="nav-title">{g.title}</p>
                  {items.map((n) => (
                    <Link key={n.href} href={n.href} className={`nav-link${isActive(path, n.href) ? ' active' : ''}`} aria-current={isActive(path, n.href) ? 'page' : undefined}>
                      <Icon name={n.icon} />
                      <span>{n.label}</span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>
        )}
        <p className="sidebar-foot small muted">SynergyOne pharmacy module</p>
      </aside>
      {navOpen && <div className="scrim no-print" onClick={() => setNavOpen(false)} />}

      <div className="shell-main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="crumb">
            <strong>{current?.label ?? (path === '/' ? 'Overview' : 'PharmTrack')}</strong>
            <span className="small muted">PharmTrack{current ? ` / ${current.label}` : ''}</span>
          </div>
          {ready && <PageSearch items={ALL.filter(visible)} />}
          <ThemeToggle />
          {ready && <UserMenu />}
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

/** Jumps to a screen. Ctrl+K or Cmd+K focuses it. */
function PageSearch({ items }: { items: NavItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const term = q.trim().toLowerCase();
  const hits = term ? items.filter((n) => `${n.label} ${n.hint}`.toLowerCase().includes(term)) : items;
  const go = (n: NavItem) => {
    setQ('');
    ref.current?.blur();
    router.push(n.href);
  };
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        ref={ref}
        value={q}
        placeholder="Search screens"
        aria-label="Search screens"
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === 'Enter' && hits[sel]) go(hits[sel]);
          if (e.key === 'Escape') ref.current?.blur();
        }}
      />
      <kbd>⌘K</kbd>
      {focus && (
        <ul className="search-results card" role="listbox">
          {hits.length ? hits.map((n, i) => (
            <li key={n.href} role="option" aria-selected={i === sel} onMouseDown={() => go(n)}>
              <Icon name={n.icon} size={18} />
              <span><strong>{n.label}</strong><span className="small muted">{n.hint}</span></span>
            </li>
          )) : <li className="muted">No matching screen</li>}
        </ul>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
    setDark(!dark);
  };
  return (
    <button className="icon-btn" onClick={toggle} aria-label={dark ? 'Use light theme' : 'Use dark theme'} title={dark ? 'Light theme' : 'Dark theme'}>
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}

function UserMenu() {
  const { session, setSession, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const initials = session.userId.replace(/[^A-Za-z0-9]/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div className="user" ref={wrap}>
      <button className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="avatar">{initials}</span>
        <span className="user-text">
          <strong>{session.userId}</strong>
          <span className="small muted">{roleLabel(session.role)} · {session.storeId}</span>
        </span>
        <Icon name="chevron" size={16} />
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
      <section className="card stack" style={{ maxWidth: 420, margin: '48px auto' }}>
        <h1 style={{ margin: 0 }}>Sign in to PharmTrack</h1>
        <p className="muted" style={{ margin: 0 }}>Use your SynergyOne account.</p>
        <button className="primary" onClick={signIn}>Sign in with SynergyOne</button>
      </section>
    );
  return <>{children}</>;
}
