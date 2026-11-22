import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RefillStatus } from '@prisma/client';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
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
  @Roles(...PHARMACY, Role.SYSTEM, Role.PRESCRIBER)
  get(@Param('id') id: string) {
    return this.refills.get(id);
  }

  @Get('refills/:id/adherence')
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
  @Roles(...PHARMACY)
  notificationsList(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return this.notifications.list({ patientId, status });
  }

  @Get('patients/:patientId/contact-preferences')
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

  @Put('facilities/:facilityId/profile')
  @Roles(Role.ADMINISTRATOR)
  facility(@Param('facilityId') facilityId: string, @Body() dto: FacilityProfileDto) {
    return this.notifications.setFacilityProfile(facilityId, dto);
  }

  @Put('sms-templates')
  @Roles(Role.ADMINISTRATOR)
  template(@Body() dto: SmsTemplateDto) {
    return this.notifications.upsertTemplate(dto);
  }

  /** Delivery-report webhook for the SMS gateway. */
  @Post('notifications/sms/delivery-reports')
  @HttpCode(200)
  @Roles(Role.SYSTEM)
  deliveryReport(@Body() dto: DeliveryReportDto) {
    return this.notifications.deliveryReport(dto);
  }
}
