// Server-side helper for calling the PharmTrack API from Next.js server components.
const API = process.env.PHARMTRACK_API_URL ?? 'http://localhost:3000';

export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}/api/v1${path}`, {
      cache: 'no-store',
      headers: { 'x-user-id': 'web-dev', 'x-user-roles': 'PHARMACIST' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
