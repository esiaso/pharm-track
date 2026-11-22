'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

/**
 * Who is using the app, and where. Until SynergyOne SSO is wired in, the API
 * runs in dev-headers mode and trusts these values, so this is a development aid.
 */
export interface Session {
  userId: string;
  role: string;
  facilityId: string;
  storeId: string;
}

export const ROLES = ['PHARMACIST', 'PHARMACY_TECHNICIAN', 'PRESCRIBER', 'STORE_KEEPER', 'ADMINISTRATOR'] as const;

const DEFAULT: Session = { userId: 'pharmacist-1', role: 'PHARMACIST', facilityId: 'FAC-1', storeId: 'STORE-1' };
const KEY = 'pharmtrack.session';

const Ctx = createContext<{ session: Session; setSession: (s: Session) => void }>({ session: DEFAULT, setSession: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setState] = useState<Session>(DEFAULT);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...DEFAULT, ...JSON.parse(raw) });
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, []);
  const setSession = (s: Session) => {
    setState(s);
    currentSession = s;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };
  currentSession = session;
  return <Ctx.Provider value={{ session, setSession }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** Read by the API client outside React. */
export let currentSession: Session = DEFAULT;
