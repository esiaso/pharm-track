import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { AssessAdrDto, CreateAdrDto, CreateAllergyDto, MarkAdrSubmittedDto, MarkAdrAcknowledgedDto, UpdateAllergyDto } from './records.dto';
import { RecordsService } from './records.service';

const CLINICAL = [Role.PRESCRIBER, Role.PHARMACIST, Role.SYSTEM];

@ApiTags('patient-safety-records')
@Controller()
export class RecordsController {
  constructor(private readonly service: RecordsService) {}

  @Get('patients/:patientId/allergies')
  @Roles(...CLINICAL, Role.PHARMACY_TECHNICIAN)
  allergies(@Param('patientId') patientId: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.listAllergies(patientId, includeInactive === 'true');
  }

  @Post('allergies')
  @Roles(...CLINICAL)
  recordAllergy(@Body() dto: CreateAllergyDto, @CurrentActor() actor: Actor) {
    return this.service.recordAllergy(dto, actor);
  }

  @Patch('allergies/:id')
  @Roles(...CLINICAL)
  updateAllergy(@Param('id') id: string, @Body() dto: UpdateAllergyDto, @CurrentActor() actor: Actor) {
    return this.service.updateAllergy(id, dto, actor);
  }

  @Get('adrs')
  @Roles(Role.PHARMACIST)
  adrs(@Query('patientId') patientId?: string, @Query('ppbReportStatus') ppbReportStatus?: string) {
    return this.service.listAdrs({ patientId, ppbReportStatus });
  }

  @Post('adrs')
  @Roles(...CLINICAL)
  reportAdr(@Body() dto: CreateAdrDto, @CurrentActor() actor: Actor) {
    return this.service.reportAdr(dto, actor);
  }

  @Patch('adrs/:id/assessment')
  @Roles(Role.PHARMACIST)
  assess(@Param('id') id: string, @Body() dto: AssessAdrDto, @CurrentActor() actor: Actor) {
    return this.service.assessAdr(id, dto, actor);
  }

  @Get('adrs/:id/ppb-export')
  @Roles(Role.PHARMACIST)
  exportPpb(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.service.exportAdrForPpb(id, actor);
  }

  @Post('adrs/:id/ppb-submitted')
  @Roles(Role.PHARMACIST)
  submitted(@Param('id') id: string, @Body() dto: MarkAdrSubmittedDto, @CurrentActor() actor: Actor) {
    return this.service.markAdrSubmitted(id, dto, actor);
  }

  /** PPB has acknowledged the report (e.g. assigned its own case number). */
  @Post('adrs/:id/ppb-acknowledged')
  @Roles(Role.PHARMACIST)
  acknowledged(@Param('id') id: string, @Body() dto: MarkAdrAcknowledgedDto, @CurrentActor() actor: Actor) {
    return this.service.markAdrAcknowledged(id, dto, actor);
  }
}
