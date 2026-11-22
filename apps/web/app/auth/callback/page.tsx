'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { userManager } from '../../../lib/auth';

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    userManager()
      .signinRedirectCallback()
      .then((user) => router.replace(((user.state as { returnTo?: string } | undefined)?.returnTo) || '/'))
      .catch((e: Error) => setError(e.message));
  }, [router]);
  return error ? <div className="error">Sign-in failed: {error}</div> : <p className="muted">Signing you in…</p>;
}
