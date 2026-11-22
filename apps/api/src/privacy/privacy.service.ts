import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { cutoff, REDACTED_SMS, RetentionPolicy, retentionFromEnv } from '../domain/retention';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLogQuery } from './privacy.dto';

export type RetentionCounts = {
  smsContent: number;
  outboxPayloads: number;
  idempotencyRecords: number;
  contactDetails: number;
  accessLogRows: number;
};

/**
 * Kenya Data Protection Act support: the patient access log, a patient's data
 * on request (right of access), erasing SMS contact details, and retention.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);
  readonly policy: RetentionPolicy = retentionFromEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Access log ──────────────────────────────────────────────────────────

  async accessLog(q: AccessLogQuery) {
    const where: Prisma.PatientAccessLogWhereInput = {
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to ? { at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.patientAccessLog.findMany({ where, orderBy: { at: 'desc' }, take: q.limit ?? 200 }),
      this.prisma.patientAccessLog.count({ where }),
    ]);
    return { total, rows };
  }

  // ─── Right of access ─────────────────────────────────────────────────────

  /** Everything PharmTrack holds about a patient, for a data subject access request. */
  async exportPatient(patientId: string, actor: Actor) {
    const [contact, allergies, adrs, prescriptions, refills, notifications, controlled, access] = await Promise.all([
      this.prisma.patientContactPreference.findUnique({ where: { patientId } }),
      this.prisma.allergy.findMany({ where: { patientId }, include: { drug: { select: { genericName: true, strength: true, hptCode: true } } }, orderBy: { recordedAt: 'asc' } }),
      this.prisma.adverseDrugReaction.findMany({ where: { patientId }, include: { drug: { select: { genericName: true, strength: true, hptCode: true } } }, orderBy: { reportedAt: 'asc' } }),
      this.prisma.prescription.findMany({
        where: { patientId },
        orderBy: { signedAt: 'asc' },
        include: {
          items: { include: { drug: { select: { genericName: true, strength: true, hptCode: true, atcCode: true } }, safetyAlerts: true } },
          dispenseOrders: { include: { lines: true } },
        },
      }),
      this.prisma.refillSchedule.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.notification.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.controlledDrugRegisterEntry.findMany({ where: { patientId }, orderBy: { recordedAt: 'asc' } }),
      this.prisma.patientAccessLog.findMany({ where: { patientId }, orderBy: { at: 'asc' } }),
    ]);
    const empty = !contact && !allergies.length && !adrs.length && !prescriptions.length && !notifications.length;
    if (empty) throw new NotFoundException(`PharmTrack holds no records for patient ${patientId}.`);
    await this.audit.log(this.prisma, actor, 'patient.export', 'Patient', patientId);
    return {
      patientId,
      generatedAt: new Date().toISOString(),
      generatedBy: actor.id,
      note: 'Data held by PharmTrack (the SynergyOne pharmacy module). Demographics and clinical notes are held by CliniTrack.',
      contactPreferences: contact,
      allergies,
      adverseDrugReactions: adrs,
      prescriptions,
      refillSchedules: refills,
      smsMessages: notifications,
      controlledDrugRegister: controlled,
      accessLog: access,
    };
  }

  // ─── Erasure of contact details ──────────────────────────────────────────

  /**
   * Removes the phone number and first name and stops SMS. Clinical records
   * are kept: they are needed for the patient's care and the law requires them.
   */
  async eraseContact(patientId: string, reason: string, actor: Actor) {
    const pref = await this.prisma.patientContactPreference.findUnique({ where: { patientId } });
    if (!pref) throw new NotFoundException(`No contact details are held for patient ${patientId}.`);
    return this.prisma.$transaction(async (tx) => {
      await tx.patientContactPreference.update({
        where: { patientId },
        data: { firstName: null, phoneE164: null, smsOptIn: false, consentRecordedAt: null, erasedAt: new Date() },
      });
      const stopped = await tx.notification.updateMany({ where: { patientId, status: 'QUEUED' }, data: { status: 'SKIPPED_NO_CONSENT', toAddress: null } });
      const redacted = await tx.notification.updateMany({ where: { patientId, toAddress: { not: null } }, data: { toAddress: null } });
      await this.audit.log(tx, actor, 'patient-contact.erase', 'PatientContactPreference', patientId, { smsOptIn: pref.smsOptIn }, { reason, stoppedMessages: stopped.count });
      return { patientId, erased: true, stoppedMessages: stopped.count, phoneNumbersRemovedFromMessages: redacted.count };
    });
  }

  // ─── Retention ───────────────────────────────────────────────────────────

  private filters(now: Date) {
    const p = this.policy;
    return {
      sms: { status: { not: 'QUEUED' as const }, createdAt: { lt: cutoff(now, p.smsContentDays) }, body: { not: REDACTED_SMS } },
      outbox: { status: 'DELIVERED' as const, deliveredAt: { lt: cutoff(now, p.integrationPayloadDays) }, NOT: { payload: { equals: {} } } },
      inbox: { receivedAt: { lt: cutoff(now, p.integrationPayloadDays) } },
      contact: {
        smsOptIn: false,
        erasedAt: null,
        updatedAt: { lt: cutoff(now, p.contactAfterOptOutDays) },
        OR: [{ phoneE164: { not: null } }, { firstName: { not: null } }],
      },
      access: { at: { lt: cutoff(now, p.accessLogDays) } },
    } satisfies Record<string, unknown>;
  }

  /** What a run would remove now, without changing anything. */
  async retentionPreview(now = new Date()) {
    const f = this.filters(now);
    const [smsContent, outboxPayloads, idempotencyRecords, contactDetails, accessLogRows] = await Promise.all([
      this.prisma.notification.count({ where: f.sms }),
      this.prisma.outboxEvent.count({ where: f.outbox }),
      this.prisma.inboxMessage.count({ where: f.inbox }),
      this.prisma.patientContactPreference.count({ where: f.contact }),
      this.prisma.patientAccessLog.count({ where: f.access }),
    ]);
    const lastRun = await this.prisma.retentionRun.findFirst({ orderBy: { startedAt: 'desc' } });
    return {
      enabled: process.env.RETENTION_ENABLED === 'true',
      policy: this.policy,
      due: { smsContent, outboxPayloads, idempotencyRecords, contactDetails, accessLogRows } satisfies RetentionCounts,
      lastRun,
    };
  }

  async runRetention(trigger: 'CRON' | 'MANUAL', actor?: Actor, now = new Date()) {
    const f = this.filters(now);
    const results = await this.prisma.$transaction(async (tx) => {
      const sms = await tx.notification.updateMany({ where: f.sms, data: { body: REDACTED_SMS, toAddress: null } });
      const outbox = await tx.outboxEvent.updateMany({ where: f.outbox, data: { payload: {} } });
      const inbox = await tx.inboxMessage.deleteMany({ where: f.inbox });
      const contact = await tx.patientContactPreference.updateMany({ where: f.contact, data: { phoneE164: null, firstName: null, erasedAt: now } });
      const access = await tx.patientAccessLog.deleteMany({ where: f.access });
      const counts: RetentionCounts = {
        smsContent: sms.count,
        outboxPayloads: outbox.count,
        idempotencyRecords: inbox.count,
        contactDetails: contact.count,
        accessLogRows: access.count,
      };
      const run = await tx.retentionRun.create({ data: { trigger, actorId: actor?.id ?? null, results: { policy: { ...this.policy }, removed: counts } } });
      if (actor) await this.audit.log(tx, actor, 'retention.run', 'RetentionRun', run.id, undefined, counts);
      return { id: run.id, removed: counts };
    });
    return results;
  }

  /** Daily at 01:30 Nairobi time, when RETENTION_ENABLED=true. */
  @Cron('30 22 * * *', { timeZone: 'UTC' })
  async scheduled() {
    if (process.env.RETENTION_ENABLED !== 'true') return;
    try {
      const r = await this.runRetention('CRON');
      this.logger.log(`Retention run ${r.id}: ${JSON.stringify(r.removed)}`);
    } catch (e) {
      this.logger.error(`Retention run failed: ${(e as Error).message}`);
    }
  }
}
