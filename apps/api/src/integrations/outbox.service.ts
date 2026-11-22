import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { ClinitrackClient } from './clinitrack.client';
import { IntegrationError } from './http';
import { SupplyTrackClient } from './supplytrack.client';
import { jobsEnabled } from '../common/jobs';

export type Destination = 'CLINITRACK' | 'SUPPLYTRACK';

const MAX_ATTEMPTS = 10;

/** Exponential backoff: 30s, 1m, 2m, 4m ... capped at 1h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

/**
 * Transactional outbox. Call `enqueue` with the same transaction client as the
 * state change; the dispatcher delivers with retries and an idempotency key so
 * downstream systems can safely see a message more than once.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clinitrack: ClinitrackClient,
    private readonly supplytrack: SupplyTrackClient,
  ) {}

  async enqueue(tx: Tx, destination: Destination, type: string, idempotencyKey: string, payload: unknown): Promise<void> {
    await tx.outboxEvent.upsert({
      where: { idempotencyKey },
      create: {
        destination,
        type,
        idempotencyKey,
        payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatchOnSchedule() {
    if (jobsEnabled()) await this.dispatchDue();
  }

  async dispatchDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.outboxEvent.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const ev of due) await this.deliverOne(ev);
      return due.length;
    } finally {
      this.running = false;
    }
  }

  private async deliverOne(ev: { id: string; destination: string; type: string; idempotencyKey: string; payload: Prisma.JsonValue; attempts: number }) {
    try {
      const result = await this.route(ev.destination as Destination, ev.type, ev.payload, ev.idempotencyKey);
      await this.prisma.outboxEvent.update({
        where: { id: ev.id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      await this.afterDelivery(ev.type, ev.payload, result);
    } catch (e) {
      const attempts = ev.attempts + 1;
      const retryable = !(e instanceof IntegrationError) || e.retryable;
      const dead = !retryable || attempts >= MAX_ATTEMPTS;
      this.logger.warn(`Outbox ${ev.type} (${ev.idempotencyKey}) attempt ${attempts} failed: ${(e as Error).message}`);
      await this.prisma.outboxEvent.update({
        where: { id: ev.id },
        data: {
          attempts,
          lastError: (e as Error).message.slice(0, 1000),
          status: dead ? 'DEAD' : 'PENDING',
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
      if (dead) await this.afterDeadLetter(ev.type, ev.payload);
    }
  }

  private async route(destination: Destination, type: string, payload: Prisma.JsonValue, key: string) {
    if (destination === 'CLINITRACK') return this.clinitrack.deliverEvent(type, payload, key);
    const p = payload as Record<string, any>;
    switch (type) {
      case 'stock.commit':
        return this.supplytrack.commit(p.reservationId, key);
      case 'stock.release':
        return this.supplytrack.release(p.reservationId, key);
      case 'stock.return':
        return this.supplytrack.returnStock({ ...(p as any), idempotencyKey: key });
      case 'stockout.report':
        return this.supplytrack.submitStockOutReport(p, key);
      default:
        throw new IntegrationError(`No SupplyTrack route for ${type}`, undefined, false);
    }
  }

  /** Records CliniTrack's billing reference once a billable event is accepted. */
  private async afterDelivery(type: string, payload: Prisma.JsonValue, result: unknown) {
    if (type === 'report.submitted' || type === 'stockout.report') {
      // Keep the receiving system's reference on the report run.
      const reference = (result as { reference?: string } | undefined)?.reference;
      const runId = (payload as any)?.reportId as string | undefined;
      if (reference && runId) await this.prisma.reportRun.updateMany({ where: { id: runId }, data: { externalRef: reference } });
      return;
    }
    if (type !== 'dispense.completed') return;
    const lineIds = ((payload as any)?.lines ?? []).map((l: any) => l.dispenseLineId as string);
    const reference = (result as { reference?: string } | undefined)?.reference;
    await this.prisma.dispenseLine.updateMany({
      where: { id: { in: lineIds }, billingStatus: 'PENDING' },
      data: { billingStatus: 'SENT', ...(reference ? { billingRef: reference } : {}) },
    });
  }

  private async afterDeadLetter(type: string, payload: Prisma.JsonValue) {
    if (type !== 'dispense.completed') return;
    const lineIds = ((payload as any)?.lines ?? []).map((l: any) => l.dispenseLineId as string);
    await this.prisma.dispenseLine.updateMany({ where: { id: { in: lineIds } }, data: { billingStatus: 'FAILED' } });
  }
}
