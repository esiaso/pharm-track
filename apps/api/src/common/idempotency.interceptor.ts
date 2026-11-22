import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from './roles';

const WRITE = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Replays the stored response when a write is retried with the same
 * Idempotency-Key (scoped to the caller). Used by CliniTrack, SupplyTrack and
 * the web app so a network retry never dispenses, refills or records twice.
 *
 * - Same key, same request, finished  → same status and body.
 * - Same key, still running           → 409.
 * - Same key, different request       → 422.
 * - Failed requests are forgotten so they can be retried.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const header = req.headers['idempotency-key'];
    if (!WRITE.has(req.method) || typeof header !== 'string' || !header) return next.handle();
    if (header.length > 200) return throwError(() => new UnprocessableEntityException('Idempotency-Key is too long.'));

    const actor: Actor | undefined = req.actor;
    const key = `${actor?.id ?? 'anonymous'}:${header}`;
    const type = `${req.method} ${req.route?.path ?? req.path}`;
    const requestHash = createHash('sha256').update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? {})}`).digest('hex');

    return from(this.claim(key, actor?.id ?? 'anonymous', type, requestHash)).pipe(
      mergeMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new UnprocessableEntityException('This Idempotency-Key was already used for a different request.');
          }
          if (existing.responseStatus === null) throw new ConflictException('A request with this Idempotency-Key is still being processed.');
          res.status(existing.responseStatus);
          res.setHeader('idempotent-replay', 'true');
          return of(existing.responseBody);
        }
        // Nest applies the final status (e.g. 201 for POST) after interceptors run,
        // so the response is stored once it has actually been sent.
        let body: unknown;
        res.once('finish', () => {
          const done =
            res.statusCode < 400
              ? this.prisma.inboxMessage.update({
                  where: { idempotencyKey: key },
                  data: {
                    responseStatus: res.statusCode,
                    responseBody: body === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue),
                    completedAt: new Date(),
                  },
                })
              : this.prisma.inboxMessage.delete({ where: { idempotencyKey: key } });
          done.catch(() => undefined);
        });
        return next.handle().pipe(
          mergeMap((b) => {
            body = b;
            return of(b);
          }),
          catchError((err) =>
            from(this.prisma.inboxMessage.delete({ where: { idempotencyKey: key } }).catch(() => undefined)).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  /** Inserts the claim; returns the existing row if the key was already used. */
  private async claim(key: string, source: string, type: string, requestHash: string) {
    try {
      await this.prisma.inboxMessage.create({ data: { idempotencyKey: key, source, type, requestHash } });
      return null;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.inboxMessage.findUnique({ where: { idempotencyKey: key } });
      }
      throw e;
    }
  }
}
