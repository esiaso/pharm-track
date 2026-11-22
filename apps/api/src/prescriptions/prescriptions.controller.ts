import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { CancelDto, SignedPrescriptionDto } from './prescriptions.dto';
import { PrescriptionsService } from './prescriptions.service';

@ApiTags('prescriptions')
@Controller()
export class PrescriptionsController {
  constructor(private readonly service: PrescriptionsService) {}

  /** CliniTrack posts each signed prescription here. 201 on first delivery, 200 on re-delivery. */
  @Post('prescriptions')
  @Roles(Role.SYSTEM, Role.PRESCRIBER)
  async receive(@Body() dto: SignedPrescriptionDto, @CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    const { prescription, duplicate } = await this.service.receiveSigned(dto, actor);
    res.status(duplicate ? 200 : 201);
    return prescription;
  }

  @Get('prescriptions/:id')
  @Roles(Role.SYSTEM, Role.PRESCRIBER, Role.PHARMACIST, Role.PHARMACY_TECHNICIAN)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('prescriptions/:id/cancel')
  @Roles(Role.SYSTEM, Role.PRESCRIBER, Role.PHARMACIST)
  cancel(@Param('id') id: string, @Body() dto: CancelDto, @CurrentActor() actor: Actor) {
    return this.service.cancel(id, dto, actor);
  }

  @Get('patients/:patientId/medication-history')
  @Roles(Role.SYSTEM, Role.PRESCRIBER, Role.PHARMACIST, Role.PHARMACY_TECHNICIAN)
  history(@Param('patientId') patientId: string) {
    return this.service.history(patientId);
  }
}
