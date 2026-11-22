import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { PatientData } from '../common/patient-access';
import { AccessLogQuery, EraseContactDto } from './privacy.dto';
import { PrivacyService } from './privacy.service';

/** Data protection tasks. Administrators only (the data protection officer's role). */
@ApiTags('privacy')
@Controller('privacy')
@Roles(Role.ADMINISTRATOR)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** Who read which patient's data, and when. */
  @Get('access-log')
  accessLog(@Query() q: AccessLogQuery) {
    return this.privacy.accessLog(q);
  }

  /** Everything PharmTrack holds about one patient (data subject access request). */
  @Get('patients/:patientId/export')
  @PatientData('patient.export')
  exportPatient(@Param('patientId') patientId: string, @CurrentActor() actor: Actor) {
    return this.privacy.exportPatient(patientId, actor);
  }

  /** Removes the patient's phone number and first name and stops SMS. Clinical records are kept. */
  @Post('patients/:patientId/erase-contact')
  @HttpCode(200)
  eraseContact(@Param('patientId') patientId: string, @Body() dto: EraseContactDto, @CurrentActor() actor: Actor) {
    return this.privacy.eraseContact(patientId, dto.reason, actor);
  }

  @Get('retention')
  retention() {
    return this.privacy.retentionPreview();
  }

  @Post('retention/run')
  @HttpCode(200)
  runRetention(@CurrentActor() actor: Actor) {
    return this.privacy.runRetention('MANUAL', actor);
  }
}
