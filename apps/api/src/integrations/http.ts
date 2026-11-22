/** Small fetch wrapper for calls to sibling SynergyOne systems. */
export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** False for 4xx responses that will never succeed on retry. */
    readonly retryable = true,
  ) {
    super(message);
  }
}

export async function callJson<T>(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { body?: unknown; idempotencyKey?: string; timeoutMs?: number; token?: string } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-source-system': 'PHARMTRACK',
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      throw new IntegrationError(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, res.status, retryable);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (e) {
    if (e instanceof IntegrationError) throw e;
    throw new IntegrationError(`${method} ${path} failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
