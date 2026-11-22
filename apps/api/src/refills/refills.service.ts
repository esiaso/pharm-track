import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Drug, PrescriptionItem, RefillSchedule, RefillStatus } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { daysOfSupply, DEFAULT_REFILL_POLICY, refillStatus, reminderToSend, scheduleAfterFill } from '../domain/refills';
import { num, PrismaService, Tx } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { RequestRefillDto } from './refills.dto';

const OPEN: RefillStatus[] = ['UPCOMING', 'DUE', 'OVERDUE'];

@Injectable()
export class RefillsService {
  private readonly logger = new Logger(RefillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Refill queue for a facility: due and overdue first. */
  list(filter: { facilityId?: string; patientId?: string; status?: RefillStatus }) {
    return this.prisma.refillSchedule.findMany({
      where: {
        facilityId: filter.facilityId,
        patientId: filter.patientId,
        status: filter.status ?? { in: OPEN },
      },
      orderBy: [{ nextDueDate: 'asc' }],
      include: { prescriptionItem: { include: { drug: true } } },
      take: 500,
    });
  }

  async get(id: string) {
    const s = await this.prisma.refillSchedule.findUnique({
      where: { id },
      include: { prescriptionItem: { include: { drug: true, prescription: true } }, dispenseOrders: true, notifications: true },
    });
    if (!s) throw new NotFoundException(`Refill schedule ${id} not found.`);
    return s;
  }

  /**
   * Opens a refill dispense order. It goes through the normal queue: pharmacist
   * verification (with an EARLY_REFILL warning if it is before the window), FEFO
   * stock from SupplyTrack and billing to CliniTrack.
   */
  async requestRefill(id: string, dto: RequestRefillDto, actor: Actor) {
    const s = await this.get(id);
    const status = refillStatus(s);
    if (!OPEN.includes(status)) throw new ConflictException(`Refill is ${status}.`);
    if (s.prescriptionItem.prescription.status !== 'SIGNED') throw new ConflictException('The prescription is no longer active.');
    if (!s.lastDispensedAt) throw new BadRequestException('The initial fill has not been dispensed yet.');
    if (s.dispenseOrders.some((o) => ['PENDING', 'IN_VERIFICATION', 'VERIFIED', 'PARTIALLY_DISPENSED'].includes(o.status))) {
      throw new ConflictException('A refill for this item is already in progress.');
    }
    const rx = s.prescriptionItem.prescription;
    const fillSequence = s.refillsUsed + 1;
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.dispenseOrder.create({
        data: {
          prescriptionId: rx.id,
          kind: 'REFILL',
          fillSequence,
          refillScheduleId: s.id,
          facilityId: rx.facilityId,
          storeId: dto.storeId ?? rx.storeId,
          priority: dto.priority ?? 'ROUTINE',
        },
      });
      await this.audit.log(tx, actor, 'refill.request', 'RefillSchedule', s.id, undefined, { orderId: order.id, fillSequence });
      return order;
    });
  }

  /** Called by dispensing, inside its transaction, once a fill of an item is complete. */
  async onFillDispensed(tx: Tx, item: PrescriptionItem & { drug: Drug }, isRefill: boolean, dispensedAt: Date) {
    const s = await tx.refillSchedule.findUnique({ where: { prescriptionItemId: item.id } });
    if (!s || s.status === 'CANCELLED') return;
    const next = scheduleAfterFill(
      s,
      { dispensedAt, isRefill, daysOfSupply: daysOfSupply(supplyInputs(item)) },
      { ...DEFAULT_REFILL_POLICY, graceDays: s.graceDays },
    );
    await tx.refillSchedule.update({
      where: { id: s.id },
      data: {
        refillsUsed: next.refillsUsed,
        lastDispensedAt: next.lastDispensedAt,
        nextDueDate: next.nextDueDate,
        earliestRefillDate: next.earliestRefillDate,
        status: next.status,
      },
    });
  }

  /**
   * Daily at 07:00 East Africa Time: refresh refill statuses and queue reminder
   * SMS (before due, on the due date, when overdue).
   */
  @Cron('0 7 * * *', { timeZone: 'Africa/Nairobi' })
  async runDailyReminders(today = new Date()) {
    const schedules = await this.prisma.refillSchedule.findMany({
      where: { status: { in: OPEN } },
      include: { prescriptionItem: { include: { drug: true } } },
    });
    let queued = 0;
    for (const s of schedules) {
      const status = refillStatus(s, today);
      if (status !== s.status) await this.prisma.refillSchedule.update({ where: { id: s.id }, data: { status } });
      const purpose = reminderToSend({ ...s, status }, today);
      if (!purpose || !s.nextDueDate) continue;
      const dueDate = s.nextDueDate.toISOString().slice(0, 10);
      await this.notifications.queue({
        patientId: s.patientId,
        facilityId: s.facilityId,
        purpose,
        refillScheduleId: s.id,
        // Overdue reminders go out once per cycle; others once per purpose per cycle.
        dedupeKey: `${purpose}:${s.id}:${dueDate}`,
        vars: { drugName: `${s.prescriptionItem.drug.genericName} ${s.prescriptionItem.drug.strength}`, dueDate: formatDate(s.nextDueDate) },
      });
      queued++;
    }
    this.logger.log(`Refill reminders: ${schedules.length} schedules checked, ${queued} reminders queued.`);
    return { checked: schedules.length, queued };
  }

  /** Adherence summary for a patient's refill item, from fill history. */
  async adherence(id: string) {
    const s = await this.get(id);
    const lines = await this.prisma.dispenseLine.findMany({
      where: { prescriptionItemId: s.prescriptionItemId },
      include: { dispenseOrder: true },
      orderBy: { dispensedAt: 'asc' },
    });
    const fills = new Map<string, Date>();
    for (const l of lines) if (!fills.has(l.dispenseOrderId)) fills.set(l.dispenseOrderId, l.dispensedAt);
    const days = daysOfSupply(supplyInputs(s.prescriptionItem));
    const dates = [...fills.values()];
    const lateness = dates.slice(1).map((d, i) => Math.round((d.getTime() - dates[i]!.getTime()) / 86_400_000) - days);
    return {
      scheduleId: s.id,
      fills: dates.length,
      refillsUsed: s.refillsUsed,
      refillsAuthorised: s.refillsAuthorised,
      daysOfSupplyPerFill: days,
      averageDaysLate: lateness.length ? lateness.reduce((a, b) => a + b, 0) / lateness.length : 0,
      status: refillStatus(s),
    };
  }
}

function supplyInputs(item: PrescriptionItem & { drug: Drug }) {
  const strength = num(item.drug.strengthValue);
  const sameUnit = strength && item.drug.strengthUnit?.toLowerCase() === item.doseUnit.toLowerCase();
  return {
    quantity: num(item.quantity)!,
    unitsPerDose: sameUnit ? num(item.dose)! / strength : undefined,
    frequencyPerDay: num(item.frequencyPerDay)!,
    durationDays: item.durationDays,
  };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
}

export type { RefillSchedule };
