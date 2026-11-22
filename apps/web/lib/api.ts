'use client';

import { useCallback, useEffect, useState } from 'react';
import { currentSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: any,
  ) {
    super(Array.isArray(body?.message) ? body.message.join('; ') : (body?.message ?? `Request failed (${status})`));
  }
}

/** Calls the PharmTrack API through the Next.js /api rewrite, as the current session user. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const s = currentSession;
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'x-user-id': s.userId,
      'x-user-roles': s.role,
      'x-facility-id': s.facilityId,
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

/** Loads a GET endpoint, with reload. `path` null skips loading. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}
