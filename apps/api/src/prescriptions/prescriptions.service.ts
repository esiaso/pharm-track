import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { SafetyBlockedException } from '../common/errors';
import { addDays } from '../domain/dispensing';
import { normaliseAtc } from '../domain/codes';
import { OutboxService } from '../integrations/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import { CancelDto, SignedPrescriptionDto } from './prescriptions.dto';

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Receives a signed prescription from CliniTrack. Idempotent on externalId:
   * re-delivery returns the existing record. Safety checks are re-run here as a
   * backstop; a HARD_STOP, or a WARNING without an override reason, is refused.
   */
  async receiveSigned(dto: SignedPrescriptionDto, actor: Actor) {
    const existing = await this.prisma.prescription.findUnique({ where: { externalId: dto.externalId }, include: this.include });
    if (existing) return { prescription: existing, duplicate: true };

    const lines = await this.safety.resolveLines(dto.items);
    for (const l of lines) {
      const sent = dto.items.find((i) => i.ref === l.ref)!;
      if (normaliseAtc(sent.atcCode) !== l.drug.atcCode) {
        throw new BadRequestException(`Line ${l.ref}: ATC ${sent.atcCode} does not match the formulary (${l.drug.atcCode}) for HPT ${l.drug.hptCode}.`);
      }
    }
    const alerts = await this.safety.evaluate(dto.patientId, dto.context, lines, dto.facilityId);
    const evaluation = this.safety.evaluateOverrides(alerts, dto.overrides ?? []);
    if (!evaluation.canProceed) throw new SafetyBlockedException(evaluation);
    const overrideByKey = new Map(evaluation.overridden.map((o) => [o.key, o.reason]));

    const signedAt = new Date(dto.signedAt);
    try {
      const prescription = await this.prisma.$transaction(async (tx) => {
        const rx = await tx.prescription.create({
          data: {
            externalId: dto.externalId,
            patientId: dto.patientId,
            encounterId: dto.encounterId,
            prescriberId: dto.prescriberId,
            facilityId: dto.facilityId,
            storeId: dto.storeId,
            signedAt,
            clinicalContext: JSON.parse(JSON.stringify(dto.context)) as Prisma.InputJsonValue,
          },
        });
        for (const l of lines) {
          const sent = dto.items.find((i) => i.ref === l.ref)!;
          const item = await tx.prescriptionItem.create({
            data: {
              prescriptionId: rx.id,
              drugId: l.drug.id,
              atcCode: l.drug.atcCode,
              hptCode: l.drug.hptCode,
              dose: sent.dose,
              doseUnit: sent.doseUnit,
              frequency: sent.frequency,
              frequencyPerDay: sent.frequencyPerDay,
              route: sent.route,
              durationDays: sent.durationDays,
              quantity: sent.quantity,
              refillsAuthorised: sent.refills ?? 0,
              instructions: sent.instructions,
            },
          });
          const itemAlerts = alerts.filter((a) => a.itemRef === l.ref);
          if (itemAlerts.length) {
            await tx.safetyAlert.createMany({
              data: itemAlerts.map((a) => ({
                prescriptionItemId: item.id,
                stage: 'PRESCRIBING' as const,
                alertKey: a.key,
                type: a.type,
                severity: a.severity,
                message: a.message,
                overriddenBy: overrideByKey.has(a.key) ? dto.prescriberId : null,
                overrideReason: overrideByKey.get(a.key) ?? null,
              })),
            });
          }
          if ((sent.refills ?? 0) > 0) {
            await tx.refillSchedule.create({
              data: {
                prescriptionItemId: item.id,
                patientId: dto.patientId,
                facilityId: dto.facilityId,
                refillsAuthorised: sent.refills!,
                expiresAt: addDays(signedAt, dto.refillValidityDays ?? 180),
              },
            });
          }
        }
        await tx.dispenseOrder.create({
          data: { prescriptionId: rx.id, kind: 'INITIAL', fillSequence: 0, facilityId: dto.facilityId, storeId: dto.storeId, priority: dto.priority ?? 'ROUTINE' },
        });
        await this.audit.log(tx, actor, 'prescription.receive', 'Prescription', rx.id, undefined, { externalId: dto.externalId, overrides: evaluation.overridden });
        await this.outbox.enqueue(tx, 'CLINITRACK', 'prescription.accepted', `prescription.accepted:${rx.id}`, {
          prescriptionId: rx.id,
          externalId: rx.externalId,
          status: 'QUEUED_FOR_DISPENSING',
        });
        return tx.prescription.findUniqueOrThrow({ where: { id: rx.id }, include: this.include });
      });
      return { prescription, duplicate: false };
    } catch (e) {
      // Two deliveries raced; the other one won.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const rx = await this.prisma.prescription.findUnique({ where: { externalId: dto.externalId }, include: this.include });
        if (rx) return { prescription: rx, duplicate: true };
      }
      throw e;
    }
  }

  async get(id: string) {
    const rx = await this.prisma.prescription.findFirst({ where: { OR: [{ id }, { externalId: id }] }, include: this.include });
    if (!rx) throw new NotFoundException(`Prescription ${id} not found.`);
    return rx;
  }

  /** Medication history for a patient (what was prescribed and dispensed). */
  history(patientId: string) {
    return this.prisma.prescription.findMany({
      where: { patientId },
      orderBy: { signedAt: 'desc' },
      take: 100,
      include: { items: { include: { drug: true, dispenseLines: true, refillSchedule: true } } },
    });
  }

  /** Cancels a prescription and its open fills and refills. Stock reservations are released. */
  async cancel(idOrExternal: string, dto: CancelDto, actor: Actor) {
    const rx = await this.get(idOrExternal);
    if (rx.status !== 'SIGNED') throw new ConflictException(`Prescription is ${rx.status}.`);
    const open = rx.dispenseOrders.filter((o) => ['PENDING', 'IN_VERIFICATION', 'VERIFIED'].includes(o.status));
    return this.prisma.$transaction(async (tx) => {
      await tx.prescription.update({ where: { id: rx.id }, data: { status: 'CANCELLED' } });
      await tx.dispenseOrder.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: 'CANCELLED', cancelReason: dto.reason } });
      await tx.refillSchedule.updateMany({
        where: { prescriptionItem: { prescriptionId: rx.id }, status: { in: ['UPCOMING', 'DUE', 'OVERDUE'] } },
        data: { status: 'CANCELLED' },
      });
      await this.audit.log(tx, actor, 'prescription.cancel', 'Prescription', rx.id, undefined, { reason: dto.reason });
      return { id: rx.id, status: 'CANCELLED', cancelledOrders: open.map((o) => o.id) };
    });
  }

  private readonly include = {
    items: { include: { safetyAlerts: true, refillSchedule: true } },
    dispenseOrders: true,
  } satisfies Prisma.PrescriptionInclude;
}
