import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { normaliseHpt } from '../domain/codes';
import { PrismaService } from '../prisma/prisma.service';
import { BatchRecalledPayload, StockStatusPayload, SupplyTrackEventDto } from './integrations.dto';

const STOCK_STATUS = { 'stock.low': 'LOW', 'stock.out': 'OUT', 'stock.restored': 'RESTORED' } as const;

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Outbox monitor ──────────────────────────────────────────────────────────

  async summary() {
    const [outbox, sms, recalls, stockOut] = await Promise.all([
      this.prisma.outboxEvent.groupBy({ by: ['destination', 'status'], _count: { _all: true } }),
      this.prisma.notification.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.batchRecall.count({ where: { acknowledgedAt: null } }),
      this.prisma.stockAlert.count({ where: { status: 'OUT' } }),
    ]);
    const oldestPending = await this.prisma.outboxEvent.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return {
      outbox: outbox.map((g) => ({ destination: g.destination, status: g.status, count: g._count._all })),
      oldestPendingAt: oldestPending?.createdAt ?? null,
      sms: sms.map((g) => ({ status: g.status, count: g._count._all })),
      openRecalls: recalls,
      itemsOutOfStock: stockOut,
    };
  }

  listOutbox(filter: { status?: string; destination?: string; type?: string }) {
    return this.prisma.outboxEvent.findMany({
      where: { status: (filter.status as any) ?? undefined, destination: filter.destination, type: filter.type },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Puts a dead (or stuck) message back in the queue for immediate delivery. */
  async retry(id: string, actor: Actor) {
    const ev = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException(`Outbox message ${id} not found.`);
    if (ev.status === 'DELIVERED') throw new BadRequestException('This message was already delivered.');
    const updated = await this.prisma.outboxEvent.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() } });
    if (ev.type === 'dispense.completed') {
      const ids = ((ev.payload as any)?.lines ?? []).map((l: any) => l.dispenseLineId as string);
      await this.prisma.dispenseLine.updateMany({ where: { id: { in: ids }, billingStatus: 'FAILED' }, data: { billingStatus: 'PENDING' } });
    }
    await this.audit.log(this.prisma, actor, 'outbox.retry', 'OutboxEvent', id, { status: ev.status, attempts: ev.attempts }, { status: 'PENDING' });
    return updated;
  }

  // ── SupplyTrack inbound events ──────────────────────────────────────────────

  async handleSupplyTrackEvent(dto: SupplyTrackEventDto, actor: Actor) {
    if (dto.type === 'batch.recalled') {
      const p = this.validate(BatchRecalledPayload, dto.payload);
      const hptCode = normaliseHpt(p.hptCode);
      const recall = await this.prisma.batchRecall.upsert({
        where: { hptCode_batchNumber: { hptCode, batchNumber: p.batchNumber } },
        create: { hptCode, batchNumber: p.batchNumber, reason: p.reason, recallClass: p.recallClass, sourceRef: p.reference },
        update: { reason: p.reason, recallClass: p.recallClass, sourceRef: p.reference },
      });
      await this.audit.log(this.prisma, actor, 'recall.received', 'BatchRecall', recall.id, undefined, recall);
      const affected = await this.affectedPatients(hptCode, p.batchNumber);
      return { recallId: recall.id, affectedPatients: affected.length };
    }
    const p = this.validate(StockStatusPayload, dto.payload);
    const status = STOCK_STATUS[dto.type];
    const hptCode = normaliseHpt(p.hptCode);
    const alert = await this.prisma.stockAlert.upsert({
      where: { storeId_hptCode: { storeId: p.storeId, hptCode } },
      create: { storeId: p.storeId, hptCode, status, quantity: p.quantity },
      update: { status, quantity: p.quantity },
    });
    return { stockAlertId: alert.id, status };
  }

  listRecalls(open?: boolean) {
    return this.prisma.batchRecall.findMany({
      where: open ? { acknowledgedAt: null } : {},
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
  }

  async getRecall(id: string) {
    const recall = await this.prisma.batchRecall.findUnique({ where: { id } });
    if (!recall) throw new NotFoundException(`Recall ${id} not found.`);
    const drug = await this.prisma.drug.findUnique({ where: { hptCode: recall.hptCode } });
    return { ...recall, drug, affected: await this.affectedPatients(recall.hptCode, recall.batchNumber) };
  }

  async acknowledgeRecall(id: string, actor: Actor) {
    await this.getRecall(id);
    const r = await this.prisma.batchRecall.update({ where: { id }, data: { acknowledgedBy: actor.id, acknowledgedAt: new Date() } });
    await this.audit.log(this.prisma, actor, 'recall.acknowledge', 'BatchRecall', id);
    return r;
  }

  /** Recalled batches for an item, so dispensing can skip them even if SupplyTrack still offers them. */
  async recalledBatches(hptCode: string): Promise<Set<string>> {
    const rows = await this.prisma.batchRecall.findMany({ where: { hptCode }, select: { batchNumber: true } });
    return new Set(rows.map((r) => r.batchNumber));
  }

  listStockAlerts(storeId?: string) {
    return this.prisma.stockAlert.findMany({ where: { storeId, status: { not: 'RESTORED' } }, orderBy: { updatedAt: 'desc' } });
  }

  /** Patients who received the batch, with what and when, for follow-up. */
  private async affectedPatients(hptCode: string, batchNumber: string) {
    const lines = await this.prisma.dispenseLine.findMany({
      where: { hptCode, batchNumber },
      include: { dispenseOrder: { include: { prescription: { select: { patientId: true, externalId: true, facilityId: true } } } } },
      orderBy: { dispensedAt: 'desc' },
    });
    return lines.map((l) => ({
      patientId: l.dispenseOrder.prescription.patientId,
      prescriptionExternalId: l.dispenseOrder.prescription.externalId,
      facilityId: l.dispenseOrder.prescription.facilityId,
      dispenseOrderId: l.dispenseOrderId,
      dispenseLineId: l.id,
      quantity: Number(l.quantity) - Number(l.quantityReturned),
      dispensedAt: l.dispensedAt,
    }));
  }

  private validate<T extends object>(cls: new () => T, payload: unknown): T {
    const obj = plainToInstance(cls, payload);
    const errors = validateSync(obj, { whitelist: true });
    if (errors.length) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    return obj;
  }
}
