import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '../common/auth';
import { PatientData } from '../common/patient-access';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  /** The search box: an exact patient or prescription number, or part of a medicine's name. */
  @Get()
  @PatientData('search')
  @Roles(Role.PHARMACIST, Role.PHARMACY_TECHNICIAN)
  search(@Query('q') q = '', @Query('facilityId') facilityId?: string) {
    return this.service.search(String(q), facilityId);
  }
}
