import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { json, urlencoded } from 'express';

/**
 * Production hardening for the HTTP layer, kept free of extra dependencies:
 * security headers, request size limits and a per-address rate limit.
 */

/** Paths that take whole code lists or rule sets as JSON. */
export const LARGE_BODY_PATHS = [/^\/api\/v1\/content\//];
export const DEFAULT_BODY_LIMIT = '1mb';
export const IMPORT_BODY_LIMIT = '25mb';

/** JSON bodies up to 1 MB, 25 MB for content imports; small form bodies (SMS delivery reports). */
export function bodyParsers(): RequestHandler[] {
  const small = json({ limit: DEFAULT_BODY_LIMIT });
  const large = json({ limit: IMPORT_BODY_LIMIT });
  return [
    (req, res, next) => (LARGE_BODY_PATHS.some((p) => p.test(req.path)) ? large : small)(req, res, next),
    urlencoded({ extended: false, limit: '100kb' }),
  ];
}

/**
 * Headers for an API that returns patient data: no sniffing, no framing, no
 * referrer, nothing cached. HSTS only when served over HTTPS behind a proxy.
 */
export function securityHeaders(opts: { hsts: boolean }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    if (opts.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/**
 * Who a request counts against. Browser calls reach the API through the web
 * app's proxy, so they all share one address: count signed-in callers by
 * their credential, and only anonymous calls by address.
 */
export function rateKey(req: Pick<Request, 'ip' | 'headers'>): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth) return `t:${createHash('sha256').update(auth).digest('base64url').slice(0, 22)}`;
  const devUser = req.headers['x-user-id'];
  if (typeof devUser === 'string' && devUser) return `u:${devUser}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

/**
 * Fixed-window limit per caller (see rateKey). In-memory, so each API process
 * counts on its own; it guards against runaway clients and scripts, not a
 * determined attack (that belongs at the proxy). Health checks are exempt.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    readonly limit: number,
    readonly windowMs = 60_000,
  ) {}

  /** Returns how many seconds to wait, or 0 when the request may go ahead. */
  hit(key: string, now = Date.now()): number {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.sweep(now);
      return 0;
    }
    w.count += 1;
    return w.count > this.limit ? Math.ceil((w.start + this.windowMs - now) / 1000) : 0;
  }

  private sweep(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }

  middleware(): RequestHandler {
    return (req, res, next) => {
      if (!req.path.startsWith('/api/')) return next();
      const wait = this.hit(rateKey(req));
      if (!wait) return next();
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ statusCode: 429, message: 'Too many requests. Try again shortly.' });
    };
  }
}

/** RATE_LIMIT_PER_MINUTE: requests per minute per address; 0 turns it off. Default 600. */
export function rateLimitFromEnv(env: NodeJS.ProcessEnv): number {
  const v = Number(env.RATE_LIMIT_PER_MINUTE ?? 600);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 600;
}

/** API docs (/docs) are served in development, and in production only with API_DOCS=true. */
export const apiDocsEnabled = (env: NodeJS.ProcessEnv) => env.NODE_ENV !== 'production' || env.API_DOCS === 'true';
