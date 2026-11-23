import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationPurpose } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { atDeliveryStatus } from '../domain/africastalking';
import { DEFAULT_TEMPLATES, normaliseKenyanMobile, PLACEHOLDERS, PRIVATE_TEMPLATES, renderTemplate, tidySms, unknownPlaceholders } from '../domain/sms';
import { backoffMs } from '../integrations/outbox.service';
import { SmsProvider } from '../integrations/sms.provider';
import { PrismaService } from '../prisma/prisma.service';
import { ContactPreferenceDto, DeliveryReportDto, FacilityProfileDto, SmsTemplateDto } from './refills.dto';
import { jobsEnabled } from '../common/jobs';

const MAX_SMS_ATTEMPTS = 5;

/**
 * Patient SMS notifications. Messages are only sent to patients who have opted
 * in (consent mirrored from CliniTrack, Kenya Data Protection Act). Each message
 * has a dedupe key so a reminder goes out once per refill cycle.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsProvider,
    private readonly audit: AuditService,
  ) {}

  async queue(req: {
    patientId: string;
    facilityId: string;
    purpose: NotificationPurpose;
    dedupeKey: string;
    vars: Record<string, string | undefined>;
    refillScheduleId?: string;
    dispenseOrderId?: string;
  }) {
    const existing = await this.prisma.notification.findUnique({ where: { dedupeKey: req.dedupeKey } });
    if (existing) return existing;

    const [pref, facility] = await Promise.all([
      this.prisma.patientContactPreference.findUnique({ where: { patientId: req.patientId } }),
      this.prisma.facilityProfile.findUnique({ where: { facilityId: req.facilityId } }),
    ]);
    const language = pref?.language ?? 'en';
    const body = renderTemplate(await this.templateBody(req.facilityId, req.purpose, language), {
      patientFirstName: pref?.firstName ?? '',
      facilityName: facility?.name ?? 'the pharmacy',
      facilityPhone: facility?.phone ?? '',
      ...req.vars,
    });
    const text = tidySms(body);
    const consented = !!pref?.smsOptIn && !!pref.phoneE164;
    return this.prisma.notification.create({
      data: {
        patientId: req.patientId,
        refillScheduleId: req.refillScheduleId,
        dispenseOrderId: req.dispenseOrderId,
        purpose: req.purpose,
        toAddress: consented ? pref!.phoneE164 : null,
        body: text,
        dedupeKey: req.dedupeKey,
        status: consented ? 'QUEUED' : 'SKIPPED_NO_CONSENT',
      },
    });
  }

  /** Sends queued messages, retrying failures with backoff. */
  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueOnSchedule() {
    if (jobsEnabled()) await this.sendDue();
  }

  async sendDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.notification.findMany({
        where: { status: 'QUEUED', scheduledFor: { lte: new Date() } },
        orderBy: { scheduledFor: 'asc' },
        take: 100,
      });
      // Consent is checked again at send time: the patient may have opted out
      // (or changed number) since the message was queued.
      const prefs = new Map(
        (await this.prisma.patientContactPreference.findMany({ where: { patientId: { in: [...new Set(due.map((n) => n.patientId))] } } })).map((p) => [p.patientId, p]),
      );
      for (const n of due) {
        const pref = prefs.get(n.patientId);
        if (!pref?.smsOptIn || !pref.phoneE164) {
          await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'SKIPPED_NO_CONSENT', toAddress: null } });
          continue;
        }
        try {
          const res = await this.sms.send(pref.phoneE164, n.body, n.id);
          await this.prisma.notification.update({
            where: { id: n.id },
            data: { status: 'SENT', toAddress: pref.phoneE164, sentAt: new Date(), providerMessageId: res.providerMessageId, attempts: { increment: 1 }, lastError: null },
          });
        } catch (e) {
          const attempts = n.attempts + 1;
          // A refusal that cannot change on retry (bad number, blacklisted, sender id not approved) fails now.
          const permanent = (e as { retryable?: boolean }).retryable === false;
          this.logger.warn(`SMS ${n.id} attempt ${attempts} failed${permanent ? ' permanently' : ''}: ${(e as Error).message}`);
          await this.prisma.notification.update({
            where: { id: n.id },
            data: {
              attempts,
              lastError: (e as Error).message.slice(0, 500),
              status: permanent || attempts >= MAX_SMS_ATTEMPTS ? 'FAILED' : 'QUEUED',
              scheduledFor: new Date(Date.now() + backoffMs(attempts)),
            },
          });
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  /** Delivery report callback from the SMS gateway. */
  /** Africa's Talking delivery report (form fields id, status, failureReason). */
  async africasTalkingReport(body: Record<string, unknown>) {
    const id = typeof body.id === 'string' ? body.id : '';
    const status = atDeliveryStatus(typeof body.status === 'string' ? body.status : undefined);
    if (!id || !status) return { updated: false };
    const reason = typeof body.failureReason === 'string' && body.failureReason ? body.failureReason : String(body.status);
    return this.deliveryReport({ providerMessageId: id, status, error: status === 'FAILED' ? `Africa's Talking: ${reason}` : undefined });
  }

  async deliveryReport(dto: DeliveryReportDto) {
    const n = await this.prisma.notification.findFirst({ where: { providerMessageId: dto.providerMessageId } });
    if (!n) return { updated: false };
    await this.prisma.notification.update({
      where: { id: n.id },
      data: dto.status === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: new Date() } : { status: 'FAILED', lastError: dto.error },
    });
    return { updated: true };
  }

  async setContactPreference(patientId: string, dto: ContactPreferenceDto, actor: Actor) {
    const phoneE164 = dto.phone ? normaliseKenyanMobile(dto.phone) : null;
    if (dto.phone && !phoneE164) {
      this.logger.warn(`Unrecognised phone number format for patient ${patientId}; SMS disabled.`);
    }
    const data = {
      firstName: dto.firstName,
      phoneE164,
      smsOptIn: dto.smsOptIn && !!phoneE164,
      language: dto.language ?? 'en',
      consentRecordedAt: null as Date | null,
      erasedAt: null as Date | null,
      source: actor.roles.includes('SYSTEM' as never) ? ('CLINITRACK' as const) : ('PHARMTRACK' as const),
    };
    const before = await this.prisma.patientContactPreference.findUnique({ where: { patientId } });
    // Keep the original consent time while consent continues.
    data.consentRecordedAt = data.smsOptIn ? (before?.smsOptIn && before.consentRecordedAt ? before.consentRecordedAt : new Date()) : null;
    data.erasedAt = data.phoneE164 || data.firstName ? null : (before?.erasedAt ?? null);
    const pref = await this.prisma.patientContactPreference.upsert({ where: { patientId }, create: { patientId, ...data }, update: data });
    if (!pref.smsOptIn) {
      // Withdrawn consent stops messages already waiting to go out.
      await this.prisma.notification.updateMany({ where: { patientId, status: 'QUEUED' }, data: { status: 'SKIPPED_NO_CONSENT', toAddress: null } });
    }
    await this.audit.log(this.prisma, actor, 'patient-contact.set', 'PatientContactPreference', patientId, before ? { smsOptIn: before.smsOptIn } : undefined, {
      smsOptIn: pref.smsOptIn,
      language: pref.language,
    });
    return pref;
  }

  getContactPreference(patientId: string) {
    return this.prisma.patientContactPreference.findUnique({ where: { patientId } });
  }

  getFacilityProfile(facilityId: string) {
    return this.prisma.facilityProfile.findUnique({ where: { facilityId } });
  }

  async setFacilityProfile(facilityId: string, dto: FacilityProfileDto, actor: Actor) {
    const data = {
      name: dto.name.trim(),
      phone: dto.phone?.trim() || null,
      ...(dto.allowHardStopOverride === undefined ? {} : { allowHardStopOverride: dto.allowHardStopOverride }),
    };
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.facilityProfile.findUnique({ where: { facilityId } });
      const after = await tx.facilityProfile.upsert({ where: { facilityId }, create: { facilityId, ...data }, update: data });
      await this.audit.log(tx, actor, 'facility-profile.update', 'FacilityProfile', facilityId, before, after);
      return after;
    });
  }

  async upsertTemplate(dto: SmsTemplateDto, actor: Actor) {
    const unknown = unknownPlaceholders(dto.body);
    if (unknown.length) {
      throw new BadRequestException(`Unknown placeholder ${unknown.map((k) => `{{${k}}}`).join(', ')}. Use ${PLACEHOLDERS.map((k) => `{{${k}}}`).join(', ')}.`);
    }
    const facilityId = dto.facilityId ?? null;
    const data = { facilityId, purpose: dto.purpose, language: dto.language, body: dto.body.trim(), active: dto.active ?? true };
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.smsTemplate.findFirst({ where: { facilityId, purpose: dto.purpose, language: dto.language } });
      const saved = existing ? await tx.smsTemplate.update({ where: { id: existing.id }, data }) : await tx.smsTemplate.create({ data });
      await this.audit.log(tx, actor, 'sms-template.update', 'SmsTemplate', saved.id, existing ?? undefined, saved);
      return saved;
    });
  }

  /** Removes a facility's own wording, so the suite-wide or built-in wording applies again. */
  async resetTemplate(facilityId: string, purpose: NotificationPurpose, language: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.smsTemplate.findFirst({ where: { facilityId, purpose, language } });
      if (!existing) return { removed: false };
      await tx.smsTemplate.delete({ where: { id: existing.id } });
      await this.audit.log(tx, actor, 'sms-template.reset', 'SmsTemplate', existing.id, existing, undefined);
      return { removed: true };
    });
  }

  /**
   * The wording in force for each message and language at a facility, where it
   * comes from (facility, suite or built-in), and the wording without the medicine name.
   */
  async effectiveTemplates(facilityId: string) {
    const rows = await this.prisma.smsTemplate.findMany({ where: { OR: [{ facilityId }, { facilityId: null }], active: true } });
    const out = [];
    for (const purpose of Object.keys(DEFAULT_TEMPLATES) as NotificationPurpose[]) {
      for (const language of ['en', 'sw']) {
        const own = rows.find((r) => r.facilityId === facilityId && r.purpose === purpose && r.language === language);
        const suite = rows.find((r) => r.facilityId === null && r.purpose === purpose && r.language === language);
        const body = own?.body ?? suite?.body ?? DEFAULT_TEMPLATES[purpose][language];
        out.push({
          purpose,
          language,
          body,
          source: own ? 'facility' : suite ? 'suite' : 'default',
          updatedAt: (own ?? suite)?.updatedAt ?? null,
          namesMedicine: /\{\{\s*drugName\s*\}\}/.test(body),
          defaultBody: suite?.body ?? DEFAULT_TEMPLATES[purpose][language],
          privateBody: PRIVATE_TEMPLATES[purpose][language],
        });
      }
    }
    return { placeholders: PLACEHOLDERS, templates: out };
  }

  list(filter: { patientId?: string; status?: string }) {
    return this.prisma.notification.findMany({
      where: { patientId: filter.patientId, status: filter.status as any },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Facility template, then suite-wide template, then the built-in default. */
  private async templateBody(facilityId: string, purpose: NotificationPurpose, language: string): Promise<string> {
    const t =
      (await this.prisma.smsTemplate.findFirst({ where: { facilityId, purpose, language, active: true } })) ??
      (await this.prisma.smsTemplate.findFirst({ where: { facilityId: null, purpose, language, active: true } }));
    return t?.body ?? DEFAULT_TEMPLATES[purpose]?.[language] ?? DEFAULT_TEMPLATES[purpose]!.en!;
  }
}
