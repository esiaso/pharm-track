import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, Observable, mergeMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { Actor, primaryRole } from './auth';

const KEY = 'patient-access';

/**
 * Marks a handler as returning patient data. After the handler returns, the
 * patients in the response (and in the route or query) are written to the
 * access log in the same request. If the log cannot be written, the request
 * fails: data is not returned without a record of who saw it.
 */
export const PatientData = (action: string) => SetMetadata(KEY, action);

/** Most patients one response can log. A larger list is truncated with a marker row. */
export const MAX_LOGGED_PATIENTS = 500;

const ID_KEYS = new Set(['patientId']);
const PARAM_KEYS = ['patientId', 'patient', 'subject'];

/**
 * Collects patient ids from a response: `patientId` fields and FHIR
 * `Patient/<id>` references, up to a few levels deep.
 */
export function collectPatientIds(body: unknown, into = new Set<string>(), depth = 0): Set<string> {
  if (depth > 6 || into.size > MAX_LOGGED_PATIENTS || body === null || typeof body !== 'object') return into;
  if (Array.isArray(body)) {
    for (const x of body) collectPatientIds(x, into, depth + 1);
    return into;
  }
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (ID_KEYS.has(k) && typeof v === 'string' && v) into.add(v);
    else if (k === 'reference' && typeof v === 'string') {
      const m = /(?:^|\/)Patient\/([^/?#]+)$/.exec(v);
      if (m) into.add(decodeURIComponent(m[1]));
    } else if (v && typeof v === 'object' && !(v instanceof Date)) collectPatientIds(v, into, depth + 1);
  }
  return into;
}

export function patientIdsFromRequest(req: { params?: Record<string, unknown>; query?: Record<string, unknown> }): string[] {
  const out: string[] = [];
  for (const src of [req.params ?? {}, req.query ?? {}]) {
    for (const k of PARAM_KEYS) {
      const v = src[k];
      if (typeof v === 'string' && v) {
        const m = /(?:^|\/)Patient\/([^/?#]+)$/.exec(v);
        out.push(m ? decodeURIComponent(m[1]) : v);
      }
    }
  }
  return out;
}

@Injectable()
export class PatientAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.get<string | undefined>(KEY, ctx.getHandler());
    if (!action) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            const actor: Actor | undefined = req.actor;
            if (!actor) return body;
            const ids = collectPatientIds(body);
            for (const id of patientIdsFromRequest(req)) ids.add(id);
            if (!ids.size) return body;
            const purpose = typeof req.headers['x-purpose-of-use'] === 'string' ? req.headers['x-purpose-of-use'].slice(0, 40).toUpperCase() : null;
            const path = String(req.originalUrl ?? req.url ?? '').slice(0, 500);
            const list = [...ids];
            const logged = list.slice(0, MAX_LOGGED_PATIENTS);
            await this.prisma.patientAccessLog.createMany({
              data: [
                ...logged.map((patientId) => ({
                  patientId,
                  actorId: actor.id,
                  actorRole: primaryRole(actor),
                  facilityId: actor.facilityId ?? null,
                  action,
                  purpose,
                  path,
                })),
                ...(list.length > logged.length
                  ? [{ patientId: '*', actorId: actor.id, actorRole: primaryRole(actor), facilityId: actor.facilityId ?? null, action: `${action}.truncated`, purpose, path }]
                  : []),
              ],
            });
            return body;
          })(),
        ),
      ),
    );
  }
}
