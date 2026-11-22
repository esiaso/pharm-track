import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DispenseStatus } from '@prisma/client';
import { Actor, CurrentActor, IdempotencyKey, Role, Roles } from '../common/auth';
import { CancelDto } from '../prescriptions/prescriptions.dto';
import { BillingStatusDto, DispenseDto, ReturnDto, VerifyDto } from './dispensing.dto';
import { DispensingService } from './dispensing.service';

const PHARMACY = [Role.PHARMACIST, Role.PHARMACY_TECHNICIAN];

@ApiTags('dispensing')
@Controller('dispensing')
export class DispensingController {
  constructor(private readonly service: DispensingService) {}

  @Get('queue')
  @Roles(...PHARMACY)
  queue(@Query('storeId') storeId: string, @Query('status') status?: string) {
    const statuses = status ? (status.split(',') as DispenseStatus[]) : undefined;
    return this.service.queue(storeId, statuses);
  }

  @Get('orders/:id')
  @Roles(...PHARMACY, Role.SYSTEM)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('orders/:id/start-verification')
  @HttpCode(200)
  @Roles(Role.PHARMACIST)
  start(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.service.startVerification(id, actor);
  }

  @Post('orders/:id/verify')
  @HttpCode(200)
  @Roles(Role.PHARMACIST)
  verify(@Param('id') id: string, @Body() dto: VerifyDto, @CurrentActor() actor: Actor) {
    return this.service.verify(id, dto, actor);
  }

  @Post('orders/:id/dispense')
  @HttpCode(200)
  @Roles(...PHARMACY)
  dispense(@Param('id') id: string, @Body() dto: DispenseDto, @CurrentActor() actor: Actor, @IdempotencyKey() key?: string) {
    return this.service.dispense(id, dto, actor, key);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @Roles(Role.PHARMACIST)
  cancel(@Param('id') id: string, @Body() dto: CancelDto, @CurrentActor() actor: Actor) {
    return this.service.cancel(id, dto.reason, actor);
  }

  @Post('orders/:id/notify-ready')
  @HttpCode(200)
  @Roles(...PHARMACY)
  notifyReady(@Param('id') id: string) {
    return this.service.notifyReady(id);
  }

  @Post('lines/:lineId/returns')
  @Roles(Role.PHARMACIST)
  returnLine(@Param('lineId') lineId: string, @Body() dto: ReturnDto, @CurrentActor() actor: Actor) {
    return this.service.returnLine(lineId, dto, actor);
  }

  /** CliniTrack callback with billing references / outcomes. */
  @Post('billing-status')
  @HttpCode(200)
  @Roles(Role.SYSTEM)
  billing(@Body() dto: BillingStatusDto) {
    return this.service.updateBilling(dto);
  }

  @Get('controlled-register')
  @Roles(Role.PHARMACIST)
  register(@Query('drugId') drugId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.controlledRegister({ drugId, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
  }
}
