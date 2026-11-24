import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** The SSO server's origin, which the browser talks to for sign-in (discovery, tokens, silent renew). */
function ssoOrigin() {
  try {
    return process.env.NEXT_PUBLIC_SSO_AUTHORITY ? new URL(process.env.NEXT_PUBLIC_SSO_AUTHORITY).origin : '';
  } catch {
    return '';
  }
}

/**
 * Everything the app loads is served by itself (fonts and icons are bundled).
 * Inline scripts and styles stay allowed: Next.js and the theme script use them.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${ssoOrigin()}`.trim(),
  `frame-src 'self' ${ssoOrigin()}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' ${ssoOrigin()}`.trim(),
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
  // Docker builds set NEXT_STANDALONE=true for a self-contained server (apps/web/Dockerfile).
  ...(process.env.NEXT_STANDALONE === 'true' ? { output: 'standalone', outputFileTracingRoot: root } : {}),
  // Proxy API calls to the NestJS service so the browser talks to one origin.
  // The destination is fixed when the app is built.
  async rewrites() {
    const api = process.env.PHARMTRACK_API_URL ?? 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
