import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationPurpose } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { DEFAULT_TEMPLATES, normaliseKenyanMobile, renderTemplate } from '../domain/sms';
import { backoffMs } from '../integrations/outbox.service';
import { SmsProvider } from '../integrations/sms.provider';
import { PrismaService } from '../prisma/prisma.service';
import { ContactPreferenceDto, DeliveryReportDto, FacilityProfileDto, SmsTemplateDto } from './refills.dto';

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
    })
      .replace(/\s+,/g, ',')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const consented = !!pref?.smsOptIn && !!pref.phoneE164;
    return this.prisma.notification.create({
      data: {
        patientId: req.patientId,
        refillScheduleId: req.refillScheduleId,
        dispenseOrderId: req.dispenseOrderId,
        purpose: req.purpose,
        toAddress: consented ? pref!.phoneE164 : null,
        body,
        dedupeKey: req.dedupeKey,
        status: consented ? 'QUEUED' : 'SKIPPED_NO_CONSENT',
      },
    });
  }

  /** Sends queued messages, retrying failures with backoff. */
  @Cron(CronExpression.EVERY_MINUTE)
  async sendDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.notification.findMany({
        where: { status: 'QUEUED', scheduledFor: { lte: new Date() } },
        orderBy: { scheduledFor: 'asc' },
        take: 100,
      });
      for (const n of due) {
        try {
          const res = await this.sms.send(n.toAddress!, n.body, n.id);
          await this.prisma.notification.update({
            where: { id: n.id },
            data: { status: 'SENT', sentAt: new Date(), providerMessageId: res.providerMessageId, attempts: { increment: 1 }, lastError: null },
          });
        } catch (e) {
          const attempts = n.attempts + 1;
          this.logger.warn(`SMS ${n.id} attempt ${attempts} failed: ${(e as Error).message}`);
          await this.prisma.notification.update({
            where: { id: n.id },
            data: {
              attempts,
              lastError: (e as Error).message.slice(0, 500),
              status: attempts >= MAX_SMS_ATTEMPTS ? 'FAILED' : 'QUEUED',
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
      consentRecordedAt: dto.smsOptIn ? new Date() : null,
      source: actor.roles.includes('SYSTEM' as never) ? ('CLINITRACK' as const) : ('PHARMTRACK' as const),
    };
    const pref = await this.prisma.patientContactPreference.upsert({ where: { patientId }, create: { patientId, ...data }, update: data });
    await this.audit.log(this.prisma, actor, 'patient-contact.set', 'PatientContactPreference', patientId, undefined, {
      smsOptIn: pref.smsOptIn,
      language: pref.language,
    });
    return pref;
  }

  setFacilityProfile(facilityId: string, dto: FacilityProfileDto) {
    return this.prisma.facilityProfile.upsert({ where: { facilityId }, create: { facilityId, ...dto }, update: dto });
  }

  async upsertTemplate(dto: SmsTemplateDto) {
    const facilityId = dto.facilityId ?? null;
    const existing = await this.prisma.smsTemplate.findFirst({ where: { facilityId, purpose: dto.purpose, language: dto.language } });
    const data = { facilityId, purpose: dto.purpose, language: dto.language, body: dto.body, active: dto.active ?? true };
    return existing
      ? this.prisma.smsTemplate.update({ where: { id: existing.id }, data })
      : this.prisma.smsTemplate.create({ data });
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
