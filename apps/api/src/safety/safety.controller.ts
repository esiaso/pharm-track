import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '../common/auth';
import { SafetyCheckDto } from './safety.dto';
import { SafetyService } from './safety.service';

@ApiTags('safety')
@Controller('safety')
export class SafetyController {
  constructor(private readonly service: SafetyService) {}

  /** Called by CliniTrack's prescription pad as lines are added, and before signing. */
  @Post('check')
  @HttpCode(200)
  @Roles(Role.PRESCRIBER, Role.PHARMACIST, Role.SYSTEM)
  check(@Body() dto: SafetyCheckDto) {
    return this.service.check(dto);
  }
}
