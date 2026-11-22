import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '../common/auth';
import { ReportsService } from './reports.service';

function period(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
  return { from: start, to: end };
}

@ApiTags('reports')
@Controller('reports')
@Roles(Role.PHARMACIST, Role.SYSTEM)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('consumption')
  consumption(@Query('facilityId') facilityId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.consumption({ facilityId, ...period(from, to) });
  }

  @Get('antimicrobial-use')
  antimicrobial(@Query('facilityId') facilityId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.antimicrobialUse({ facilityId, ...period(from, to) });
  }

  @Get('refills')
  refills(@Query('facilityId') facilityId?: string) {
    return this.service.refillSummary(facilityId);
  }

  @Get('safety-overrides')
  overrides(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.overrides(period(from, to));
  }
}
