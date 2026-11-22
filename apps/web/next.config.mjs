import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
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
