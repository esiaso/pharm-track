import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { Actor, primaryRole } from './auth';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes an audit row. Pass the transaction client so the audit commits with the change. */
  async log(
    tx: Tx | PrismaService,
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: primaryRole(actor),
        action,
        entityType,
        entityId,
        before: toJson(before),
        after: toJson(after),
      },
    });
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
