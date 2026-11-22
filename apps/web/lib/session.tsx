'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { identityFrom, ssoEnabled, userManager } from './auth';

/**
 * Who is using the app, and where.
 *
 * With SynergyOne SSO configured, the user and roles come from the signed-in
 * token and only facility and store are chosen here. Without it (local
 * development) the user and role are picked by hand, and the API must run with
 * AUTH_MODE=dev-headers.
 */
export interface Session {
  userId: string;
  role: string;
  roles: string[];
  facilityId: string;
  storeId: string;
  /** Bearer token when signed in through SSO. */
  accessToken?: string;
  sso: boolean;
}

export const ROLES = ['PHARMACIST', 'PHARMACY_TECHNICIAN', 'PRESCRIBER', 'STORE_KEEPER', 'ADMINISTRATOR'] as const;

const DEFAULT: Session = { userId: 'pharmacist-1', role: 'PHARMACIST', roles: ['PHARMACIST'], facilityId: 'FAC-1', storeId: 'STORE-1', sso: false };
const KEY = 'pharmtrack.session';

type Ctx = { session: Session; setSession: (s: Partial<Session>) => void; status: 'loading' | 'ready' | 'signed-out'; signIn: () => void; signOut: () => void };
const SessionCtx = createContext<Ctx>({ session: DEFAULT, setSession: () => {}, status: 'ready', signIn: () => {}, signOut: () => {} });

/** Read by the API client outside React. */
export let currentSession: Session = DEFAULT;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setState] = useState<Session>(DEFAULT);
  // 'loading' until the saved session is restored, so no request goes out as the default user.
  const [status, setStatus] = useState<Ctx['status']>('loading');

  const update = (patch: Partial<Session>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      currentSession = next;
      try {
        const { accessToken: _t, ...keep } = next;
        localStorage.setItem(KEY, JSON.stringify(keep));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  useEffect(() => {
    let saved: Partial<Session> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      /* ignore */
    }
    if (!ssoEnabled()) {
      const next = { ...DEFAULT, ...saved, sso: false, accessToken: undefined };
      next.roles = [next.role];
      currentSession = next;
      setState(next);
      setStatus('ready');
      return;
    }
    const um = userManager();
    const apply = (user: Awaited<ReturnType<typeof um.getUser>>) => {
      if (!user || user.expired) {
        setStatus('signed-out');
        return;
      }
      const id = identityFrom(user);
      const next: Session = {
        ...DEFAULT,
        storeId: saved.storeId ?? DEFAULT.storeId,
        facilityId: id.facilityId ?? saved.facilityId ?? DEFAULT.facilityId,
        userId: id.userId,
        roles: id.roles,
        role: id.roles[0] ?? 'NONE',
        accessToken: user.access_token,
        sso: true,
      };
      currentSession = next;
      setState(next);
      setStatus('ready');
    };
    void um.getUser().then(apply);
    um.events.addUserLoaded(apply);
    um.events.addUserSignedOut(() => setStatus('signed-out'));
    return () => um.events.removeUserLoaded(apply);
  }, []);

  const signIn = () => void userManager().signinRedirect({ state: { returnTo: window.location.pathname + window.location.search } });
  const signOut = () => void userManager().signoutRedirect().catch(() => userManager().removeUser().then(() => setStatus('signed-out')));

  currentSession = session;
  return <SessionCtx.Provider value={{ session, setSession: update, status, signIn, signOut }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

/** True when the user holds any of the roles (administrators hold all). */
export function hasRole(s: Session, ...roles: string[]) {
  return s.roles.includes('ADMINISTRATOR') || roles.some((r) => s.roles.includes(r));
}
