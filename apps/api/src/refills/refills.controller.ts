import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationPurpose, RefillStatus } from '@prisma/client';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { PatientData } from '../common/patient-access';
import { NotificationsService } from './notifications.service';
import { ContactPreferenceDto, DeliveryReportDto, FacilityProfileDto, RequestRefillDto, SmsTemplateDto } from './refills.dto';
import { RefillsService } from './refills.service';

const PHARMACY = [Role.PHARMACIST, Role.PHARMACY_TECHNICIAN];

@ApiTags('refills')
@Controller()
export class RefillsController {
  constructor(
    private readonly refills: RefillsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('refills')
  @Roles(...PHARMACY, Role.SYSTEM, Role.PRESCRIBER)
  list(@Query('facilityId') facilityId?: string, @Query('patientId') patientId?: string, @Query('status') status?: RefillStatus) {
    return this.refills.list({ facilityId, patientId, status });
  }

  @Get('refills/:id')
  @PatientData('refill.read')
  @Roles(...PHARMACY, Role.SYSTEM, Role.PRESCRIBER)
  get(@Param('id') id: string) {
    return this.refills.get(id);
  }

  @Get('refills/:id/adherence')
  @PatientData('refill.adherence')
  @Roles(...PHARMACY, Role.PRESCRIBER)
  adherence(@Param('id') id: string) {
    return this.refills.adherence(id);
  }

  /** Opens a refill dispense order (from the pharmacy, or from CliniTrack when the patient asks). */
  @Post('refills/:id/request')
  @Roles(...PHARMACY, Role.SYSTEM)
  request(@Param('id') id: string, @Body() dto: RequestRefillDto, @CurrentActor() actor: Actor) {
    return this.refills.requestRefill(id, dto, actor);
  }

  /** Manual trigger of the daily reminder run (admin / ops). */
  @Post('refills/reminders/run')
  @HttpCode(200)
  @Roles(Role.ADMINISTRATOR)
  runReminders() {
    return this.refills.runDailyReminders();
  }

  @Get('notifications')
  @PatientData('notifications.list')
  @Roles(...PHARMACY)
  notificationsList(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return this.notifications.list({ patientId, status });
  }

  @Get('patients/:patientId/contact-preferences')
  @PatientData('contact-preferences.read')
  @Roles(...PHARMACY, Role.SYSTEM)
  getContact(@Param('patientId') patientId: string) {
    return this.notifications.getContactPreference(patientId);
  }

  /** CliniTrack keeps patient SMS contact and consent in sync here. */
  @Put('patients/:patientId/contact-preferences')
  @Roles(Role.SYSTEM, Role.PHARMACIST)
  contact(@Param('patientId') patientId: string, @Body() dto: ContactPreferenceDto, @CurrentActor() actor: Actor) {
    return this.notifications.setContactPreference(patientId, dto, actor);
  }

  @Get('facilities/:facilityId/profile')
  @Roles(Role.ADMINISTRATOR, ...PHARMACY)
  facilityProfile(@Param('facilityId') facilityId: string) {
    return this.notifications.getFacilityProfile(facilityId);
  }

  @Put('facilities/:facilityId/profile')
  @Roles(Role.ADMINISTRATOR)
  facility(@Param('facilityId') facilityId: string, @Body() dto: FacilityProfileDto, @CurrentActor() actor: Actor) {
    return this.notifications.setFacilityProfile(facilityId, dto, actor);
  }

  /** The SMS wording in force at a facility, per message and language. */
  @Get('facilities/:facilityId/sms-templates')
  @Roles(Role.ADMINISTRATOR, ...PHARMACY)
  facilityTemplates(@Param('facilityId') facilityId: string) {
    return this.notifications.effectiveTemplates(facilityId);
  }

  /** Goes back to the suite-wide or built-in wording for one message and language. */
  @Delete('facilities/:facilityId/sms-templates/:purpose/:language')
  @Roles(Role.ADMINISTRATOR)
  resetTemplate(
    @Param('facilityId') facilityId: string,
    @Param('purpose', new ParseEnumPipe(NotificationPurpose)) purpose: NotificationPurpose,
    @Param('language', new ParseEnumPipe(['en', 'sw'])) language: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.notifications.resetTemplate(facilityId, purpose, language, actor);
  }

  @Put('sms-templates')
  @Roles(Role.ADMINISTRATOR)
  template(@Body() dto: SmsTemplateDto, @CurrentActor() actor: Actor) {
    return this.notifications.upsertTemplate(dto, actor);
  }

  /** Delivery-report webhook for the SMS gateway. */
  @Post('notifications/sms/delivery-reports')
  @HttpCode(200)
  @Roles(Role.SYSTEM)
  deliveryReport(@Body() dto: DeliveryReportDto) {
    return this.notifications.deliveryReport(dto);
  }
}
