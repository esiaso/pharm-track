/**
 * Scheduled jobs (outbox delivery, SMS sending, refill reminders, retention)
 * run in every API process unless JOBS_ENABLED=false. With more than one API
 * replica, run the jobs in exactly one (see docs/DEPLOYMENT.md), or SMS and
 * integration messages can go out twice.
 */
export function jobsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.JOBS_ENABLED ?? 'true').toLowerCase() !== 'false';
}
