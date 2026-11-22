/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy API calls to the NestJS service so the browser talks to one origin.
  async rewrites() {
    const api = process.env.PHARMTRACK_API_URL ?? 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
