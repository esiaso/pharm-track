'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { currentSession, useSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: any,
  ) {
    super(Array.isArray(body?.message) ? body.message.join('; ') : (body?.message ?? `Request failed (${status})`));
  }
}

function authHeaders(): Record<string, string> {
  const s = currentSession;
  return {
    ...(s.sso ? { authorization: `Bearer ${s.accessToken ?? ''}` } : { 'x-user-id': s.userId, 'x-user-roles': s.role }),
    'x-facility-id': s.facilityId,
  };
}

/** Downloads a file endpoint (CSV exports, templates) with the session's credentials. */
export async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text ? JSON.parse(text) : undefined);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Calls the PharmTrack API through the Next.js /api rewrite, as the current session user. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
      ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/**
 * Loads a GET endpoint, with reload. `path` null skips loading. Loads again
 * when the user, role or facility changes (including when the saved session
 * is restored after the first render).
 */
export function useApi<T>(path: string | null) {
  const { session } = useSession();
  const who = `${session.userId}|${session.role}|${session.facilityId}|${session.accessToken ? 1 : 0}`;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current; // an older response must not overwrite a newer one
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path);
      if (mine === seq.current) setData(d);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, who]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}
