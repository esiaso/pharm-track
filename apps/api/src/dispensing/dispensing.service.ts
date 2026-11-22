import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DispenseStatus, Drug, Prisma, PrescriptionItem } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { SafetyBlockedException } from '../common/errors';
import { normaliseHpt } from '../domain/codes';
import { allocateFefo, assertTransition, InvalidTransitionError, statusAfterDispense } from '../domain/dispensing';
import { isEarlyRefill } from '../domain/refills';
import type { SafetyAlert } from '../domain/types';
import { FormularyService } from '../formulary/formulary.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { OutboxService } from '../integrations/outbox.service';
import { SupplyTrackClient } from '../integrations/supplytrack.client';
import { num, PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../refills/notifications.service';
import { RefillsService } from '../refills/refills.service';
import { ClinicalContextDto } from '../safety/safety.dto';
import { SafetyService } from '../safety/safety.service';
import { BillingStatusDto, DispenseDto, ReturnDto, VerifyDto } from './dispensing.dto';

type Item = PrescriptionItem & { drug: Drug };

@Injectable()
export class DispensingService {
  private readonly logger = new Logger(DispensingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly supply: SupplyTrackClient,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly formulary: FormularyService,
    private readonly refills: RefillsService,
    private readonly notifications: NotificationsService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Dispensing queue for a pharmacy store: STAT first, then oldest. */
  queue(storeId: string, statuses?: DispenseStatus[]) {
    return this.prisma.dispenseOrder.findMany({
      where: { storeId, status: { in: statuses ?? ['PENDING', 'IN_VERIFICATION', 'VERIFIED', 'PARTIALLY_DISPENSED'] } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: { prescription: { select: { patientId: true, externalId: true, prescriberId: true } } },
      take: 200,
    });
  }

  async get(id: string) {
    const order = await this.prisma.dispenseOrder.findUnique({
      where: { id },
      include: {
        prescription: { include: { items: { include: { drug: true, safetyAlerts: true } } } },
        refillSchedule: true,
        lines: { include: { controlledEntry: true } },
      },
    });
    if (!order) throw new NotFoundException(`Dispense order ${id} not found.`);
    return order;
  }

  async startVerification(id: string, actor: Actor) {
    const order = await this.get(id);
    this.transition(order.status, 'IN_VERIFICATION');
    await this.prisma.dispenseOrder.update({ where: { id }, data: { status: 'IN_VERIFICATION' } });
    await this.audit.log(this.prisma, actor, 'dispense.start-verification', 'DispenseOrder', id);
    return this.get(id);
  }

  /** Pharmacist verification: re-runs safety checks; WARNINGs need the pharmacist's own override. */
  async verify(id: string, dto: VerifyDto, actor: Actor) {
    const order = await this.get(id);
    if (order.status === 'PENDING') this.transition('PENDING', 'IN_VERIFICATION');
    else this.transition(order.status, 'VERIFIED');
    const rx = order.prescription;
    const items = this.itemsForOrder(order);
    const lines = items.map((i) => ({
      ref: i.id,
      drug: i.drug,
      dose: num(i.dose)!,
      doseUnit: i.doseUnit,
      frequencyPerDay: num(i.frequencyPerDay)!,
      route: i.route,
    }));
    const context = (rx.clinicalContext ?? {}) as ClinicalContextDto;
    const alerts: SafetyAlert[] = await this.safety.evaluate(rx.patientId, context, lines, rx.facilityId, rx.id);
    if (order.kind === 'REFILL' && order.refillSchedule && isEarlyRefill(order.refillSchedule)) {
      alerts.push({
        key: `EARLY_REFILL:${order.refillSchedule.id}:${order.fillSequence}`,
        itemRef: order.refillSchedule.prescriptionItemId,
        type: 'EARLY_REFILL',
        severity: 'WARNING',
        message: `Refill requested before ${order.refillSchedule.earliestRefillDate!.toISOString().slice(0, 10)}, the earliest allowed date.`,
      });
    }
    const evaluation = this.safety.evaluateOverrides(alerts, dto.overrides ?? []);
    if (!evaluation.canProceed) throw new SafetyBlockedException(evaluation);
    const reasons = new Map(evaluation.overridden.map((o) => [o.key, o.reason]));

    await this.prisma.$transaction(async (tx) => {
      if (alerts.length) {
        await tx.safetyAlert.createMany({
          data: alerts.map((a) => ({
            prescriptionItemId: a.itemRef,
            stage: 'VERIFICATION' as const,
            alertKey: a.key,
            type: a.type,
            severity: a.severity,
            message: a.message,
            overriddenBy: reasons.has(a.key) ? actor.id : null,
            overrideReason: reasons.get(a.key) ?? null,
          })),
        });
      }
      await tx.dispenseOrder.update({ where: { id }, data: { status: 'VERIFIED', verifiedBy: actor.id, verifiedAt: new Date() } });
      await this.audit.log(tx, actor, 'dispense.verify', 'DispenseOrder', id, undefined, { alerts: alerts.length, overrides: evaluation.overridden });
    });
    return { order: await this.get(id), alerts };
  }

  /**
   * Dispenses (fully or partly). For each line: pick batches FEFO from SupplyTrack,
   * reserve them, then in one transaction record the lines and queue the stock
   * deduction (SupplyTrack) and the billable items (CliniTrack) on the outbox.
   */
  async dispense(id: string, dto: DispenseDto, actor: Actor, idempotencyKey: string = randomUUID()) {
    const order = await this.get(id);
    if (order.status !== 'VERIFIED' && order.status !== 'PARTIALLY_DISPENSED') {
      throw new ConflictException(`Order must be verified before dispensing (status ${order.status}).`);
    }
    const items = this.itemsForOrder(order);
    const rx = order.prescription;

    type Planned = {
      item: Item;
      drug: Drug;
      req: DispenseDto['lines'][number];
      reservationId: string;
      allocations: ReturnType<typeof allocateFefo>['allocations'];
      unitPrice: number;
      currency: string;
    };
    const planned: Planned[] = [];
    try {
      for (const [idx, req] of dto.lines.entries()) {
        const item = items.find((i) => i.id === req.prescriptionItemId);
        if (!item) throw new BadRequestException(`Item ${req.prescriptionItemId} is not part of this order.`);
        const remaining = num(item.quantity)! - this.dispensedInOrder(order.lines, item.id);
        if (req.quantity > remaining) throw new BadRequestException(`Only ${remaining} left to dispense for ${item.drug.genericName}.`);
        const drug = await this.resolveDrug(item, req);
        if (drug.controlledSchedule !== 'NONE') {
          if (!req.witnessedBy) throw new BadRequestException(`${drug.genericName} is a controlled drug and needs a witness.`);
          if (req.witnessedBy === actor.id) throw new BadRequestException('The witness must be a different person from the dispenser.');
        }
        // Never dispense a recalled batch, even if SupplyTrack still lists it.
        const recalled = await this.integrations.recalledBatches(drug.hptCode);
        const batches = (await this.supply.getBatches(order.storeId, drug.hptCode)).filter((b) => !recalled.has(b.batchNumber));
        const fefo = allocateFefo(batches, req.quantity, { minDaysToExpiry: item.durationDays });
        if (fefo.allocated === 0) throw new ConflictException(`${drug.genericName} (${drug.hptCode}) is out of stock in store ${order.storeId}.`);
        const reservation = await this.supply.reserve({
          storeId: order.storeId,
          hptCode: drug.hptCode,
          allocations: fefo.allocations,
          reference: `dispense-order:${order.id}`,
          idempotencyKey: `${idempotencyKey}:${idx}`,
        });
        const price = await this.formulary.currentPrice(this.prisma, drug.id, dto.priceListCode ?? 'DEFAULT');
        planned.push({
          item,
          drug,
          req,
          reservationId: reservation.reservationId,
          allocations: fefo.allocations,
          unitPrice: num(price?.unitPrice) ?? 0,
          currency: price?.currency ?? 'KES',
        });
      }
    } catch (e) {
      await this.releaseAll(planned.map((p) => p.reservationId), idempotencyKey);
      throw e;
    }

    const dispensedAt = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const created: { id: string; p: Planned; batchNumber: string; expiryDate: Date; quantity: number }[] = [];
        for (const p of planned) {
          for (const a of p.allocations) {
            const line = await tx.dispenseLine.create({
              data: {
                dispenseOrderId: order.id,
                prescriptionItemId: p.item.id,
                drugId: p.drug.id,
                substitutedFromDrugId: p.drug.id !== p.item.drugId ? p.item.drugId : null,
                substitutionNote: p.drug.id !== p.item.drugId ? p.req.substitutionNote : null,
                atcCode: p.drug.atcCode,
                hptCode: p.drug.hptCode,
                quantity: a.quantity,
                batchNumber: a.batchNumber,
                expiryDate: a.expiryDate,
                supplyReservationId: p.reservationId,
                unitPrice: p.unitPrice,
                currency: p.currency,
                labelText: p.req.labelText ?? defaultLabel(p.item, p.drug),
                counsellingNotes: p.req.counsellingNotes,
                dispensedBy: actor.id,
                dispensedAt,
              },
            });
            if (p.drug.controlledSchedule !== 'NONE') {
              await tx.controlledDrugRegisterEntry.create({
                data: {
                  dispenseLineId: line.id,
                  drugId: p.drug.id,
                  patientId: rx.patientId,
                  quantity: a.quantity,
                  dispensedBy: actor.id,
                  witnessedBy: p.req.witnessedBy!,
                },
              });
            }
            created.push({ id: line.id, p, batchNumber: a.batchNumber, expiryDate: a.expiryDate, quantity: a.quantity });
          }
          await tx.prescriptionItem.update({
            where: { id: p.item.id },
            data: { quantityDispensed: { increment: p.allocations.reduce((s, a) => s + a.quantity, 0) } },
          });
          await this.outbox.enqueue(tx, 'SUPPLYTRACK', 'stock.commit', `stock.commit:${p.reservationId}`, {
            reservationId: p.reservationId,
            reference: `dispense-order:${order.id}`,
          });
        }

        // Billable items to CliniTrack (initial fills and refills alike).
        const eventId = randomUUID();
        await this.outbox.enqueue(tx, 'CLINITRACK', 'dispense.completed', `dispense.completed:${eventId}`, {
          dispenseEventId: eventId,
          dispenseOrderId: order.id,
          prescriptionId: rx.id,
          prescriptionExternalId: rx.externalId,
          patientId: rx.patientId,
          encounterId: rx.encounterId,
          facilityId: rx.facilityId,
          storeId: order.storeId,
          fillType: order.kind,
          fillSequence: order.fillSequence,
          priceListCode: dto.priceListCode ?? 'DEFAULT',
          dispensedAt: dispensedAt.toISOString(),
          dispensedBy: actor.id,
          lines: created.map((c) => ({
            dispenseLineId: c.id,
            hptCode: c.p.drug.hptCode,
            atcCode: c.p.drug.atcCode,
            genericName: c.p.drug.genericName,
            strength: c.p.drug.strength,
            unitOfIssue: c.p.drug.unitOfIssue,
            quantity: c.quantity,
            batchNumber: c.batchNumber,
            expiryDate: c.expiryDate.toISOString().slice(0, 10),
            unitPrice: c.p.unitPrice,
            currency: c.p.currency,
            substitutedFromHptCode: c.p.drug.id !== c.p.item.drugId ? c.p.item.hptCode : null,
          })),
        });

        // Order status and refill schedules.
        const progress = items.map((i) => {
          const before = this.dispensedInOrder(order.lines, i.id);
          const now = planned.filter((p) => p.item.id === i.id).reduce((s, p) => s + p.allocations.reduce((t, a) => t + a.quantity, 0), 0);
          return { item: i, ordered: num(i.quantity)!, before, dispensed: before + now };
        });
        const status = statusAfterDispense(progress);
        this.transition(order.status, status);
        await tx.dispenseOrder.update({ where: { id: order.id }, data: { status } });
        for (const pr of progress) {
          // The fill counts once the item's quantity for this fill is fully supplied.
          if (pr.before < pr.ordered && pr.dispensed >= pr.ordered) {
            await this.refills.onFillDispensed(tx, pr.item, order.kind === 'REFILL', dispensedAt);
          }
        }
        await this.completePrescriptionIfDone(tx, rx.id);
        await this.audit.log(tx, actor, 'dispense.dispense', 'DispenseOrder', order.id, undefined, {
          lines: created.map((c) => ({ id: c.id, hpt: c.p.drug.hptCode, qty: c.quantity, batch: c.batchNumber })),
          status,
        });
      });
    } catch (e) {
      await this.releaseAll(planned.map((p) => p.reservationId), idempotencyKey);
      throw e;
    }
    return this.get(order.id);
  }

  /** Patient returns medicine: restock via SupplyTrack and reverse the bill in CliniTrack. */
  async returnLine(lineId: string, dto: ReturnDto, actor: Actor) {
    const line = await this.prisma.dispenseLine.findUnique({ where: { id: lineId }, include: { dispenseOrder: { include: { lines: true } } } });
    if (!line) throw new NotFoundException(`Dispense line ${lineId} not found.`);
    const returnable = num(line.quantity)! - num(line.quantityReturned)!;
    if (dto.quantity > returnable) throw new BadRequestException(`Only ${returnable} can be returned on this line.`);
    const returnId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.dispenseLine.update({ where: { id: lineId }, data: { quantityReturned: { increment: dto.quantity } } });
      await tx.prescriptionItem.update({ where: { id: line.prescriptionItemId }, data: { quantityDispensed: { decrement: dto.quantity } } });
      await this.outbox.enqueue(tx, 'SUPPLYTRACK', 'stock.return', `stock.return:${returnId}`, {
        storeId: line.dispenseOrder.storeId,
        hptCode: line.hptCode,
        batchNumber: line.batchNumber,
        quantity: dto.quantity,
        reason: dto.reason,
        reference: `dispense-line:${line.id}`,
      });
      await this.outbox.enqueue(tx, 'CLINITRACK', 'dispense.returned', `dispense.returned:${returnId}`, {
        returnId,
        dispenseLineId: line.id,
        dispenseOrderId: line.dispenseOrderId,
        billingRef: line.billingRef,
        hptCode: line.hptCode,
        atcCode: line.atcCode,
        quantity: dto.quantity,
        unitPrice: num(line.unitPrice),
        currency: line.currency,
        reason: dto.reason,
      });
      const allReturned = line.dispenseOrder.lines.every((l) =>
        l.id === line.id ? num(l.quantityReturned)! + dto.quantity >= num(l.quantity)! : num(l.quantityReturned)! >= num(l.quantity)!,
      );
      if (allReturned) {
        this.transition(line.dispenseOrder.status, 'RETURNED');
        await tx.dispenseOrder.update({ where: { id: line.dispenseOrderId }, data: { status: 'RETURNED' } });
      }
      await this.audit.log(tx, actor, 'dispense.return', 'DispenseLine', line.id, undefined, dto);
    });
    return this.get(line.dispenseOrderId);
  }

  async cancel(id: string, reason: string, actor: Actor) {
    const order = await this.get(id);
    this.transition(order.status, 'CANCELLED');
    await this.prisma.dispenseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
    await this.audit.log(this.prisma, actor, 'dispense.cancel', 'DispenseOrder', id, undefined, { reason });
    return this.get(id);
  }

  /** "Ready for collection" SMS to the patient. */
  async notifyReady(id: string) {
    const order = await this.get(id);
    return this.notifications.queue({
      patientId: order.prescription.patientId,
      facilityId: order.facilityId,
      purpose: 'READY_FOR_COLLECTION',
      dispenseOrderId: order.id,
      dedupeKey: `READY_FOR_COLLECTION:${order.id}`,
      vars: {},
    });
  }

  /** CliniTrack reports billing outcomes for dispensed lines. */
  async updateBilling(dto: BillingStatusDto) {
    let updated = 0;
    for (const l of dto.lines) {
      const r = await this.prisma.dispenseLine.updateMany({
        where: { id: l.dispenseLineId },
        data: { billingRef: l.billingRef, billingStatus: l.status },
      });
      updated += r.count;
    }
    return { updated };
  }

  controlledRegister(filter: { drugId?: string; from?: Date; to?: Date }) {
    return this.prisma.controlledDrugRegisterEntry.findMany({
      where: { drugId: filter.drugId, recordedAt: { gte: filter.from, lte: filter.to } },
      include: { drug: true, dispenseLine: { select: { batchNumber: true, dispenseOrderId: true } } },
      orderBy: { recordedAt: 'desc' },
      take: 500,
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** INITIAL orders cover every item; REFILL orders cover only the refill's item. */
  private itemsForOrder(order: Awaited<ReturnType<DispensingService['get']>>): Item[] {
    const all = order.prescription.items;
    if (order.kind === 'REFILL') return all.filter((i) => i.id === order.refillSchedule?.prescriptionItemId);
    return all;
  }

  private dispensedInOrder(lines: { prescriptionItemId: string; quantity: Prisma.Decimal; quantityReturned: Prisma.Decimal }[], itemId: string) {
    return lines.filter((l) => l.prescriptionItemId === itemId).reduce((s, l) => s + num(l.quantity)! - num(l.quantityReturned)!, 0);
  }

  private async resolveDrug(item: Item, req: DispenseDto['lines'][number]): Promise<Drug> {
    if (!req.substituteHptCode || normaliseHpt(req.substituteHptCode) === item.hptCode) return item.drug;
    if (!req.substitutionNote) throw new BadRequestException('A substitution needs a note.');
    const sub = await this.prisma.drug.findUnique({ where: { hptCode: normaliseHpt(req.substituteHptCode) } });
    if (!sub) throw new BadRequestException(`Unknown HPT code ${req.substituteHptCode}.`);
    if (!item.drug.substitutionGroupId || sub.substitutionGroupId !== item.drug.substitutionGroupId) {
      throw new BadRequestException(`${sub.genericName} is not an approved substitute for ${item.drug.genericName}.`);
    }
    if (sub.formularyStatus === 'DISCONTINUED') throw new BadRequestException(`${sub.genericName} is discontinued.`);
    return sub;
  }

  private async completePrescriptionIfDone(tx: Prisma.TransactionClient, prescriptionId: string) {
    const rx = await tx.prescription.findUniqueOrThrow({
      where: { id: prescriptionId },
      include: { dispenseOrders: true, items: { include: { refillSchedule: true } } },
    });
    const initialDone = rx.dispenseOrders.some((o) => o.kind === 'INITIAL' && o.status === 'DISPENSED');
    const refillsOpen = rx.items.some((i) => i.refillSchedule && ['UPCOMING', 'DUE', 'OVERDUE'].includes(i.refillSchedule.status));
    const ordersOpen = rx.dispenseOrders.some((o) => ['PENDING', 'IN_VERIFICATION', 'VERIFIED', 'PARTIALLY_DISPENSED'].includes(o.status));
    if (rx.status === 'SIGNED' && initialDone && !refillsOpen && !ordersOpen) {
      await tx.prescription.update({ where: { id: rx.id }, data: { status: 'COMPLETED' } });
    }
  }

  private async releaseAll(reservationIds: string[], key: string) {
    for (const r of reservationIds) {
      try {
        await this.supply.release(r, `release:${key}:${r}`);
      } catch (e) {
        // SupplyTrack reservations also expire on their own (see contract).
        this.logger.error(`Could not release reservation ${r}: ${(e as Error).message}`);
      }
    }
  }

  private transition(from: DispenseStatus, to: DispenseStatus) {
    try {
      assertTransition(from, to);
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new ConflictException(e.message);
      throw e;
    }
  }
}

function defaultLabel(item: PrescriptionItem, drug: Drug): string {
  return [
    `${drug.genericName} ${drug.strength} ${drug.dosageForm.toLowerCase()}`,
    `${num(item.dose)} ${item.doseUnit} ${item.frequency} for ${item.durationDays} days`,
    item.instructions ?? '',
  ]
    .filter(Boolean)
    .join('. ');
}
