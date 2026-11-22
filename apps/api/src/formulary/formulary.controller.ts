import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { CreateDrugDto, FacilityFormularyDto, ImportAtcDto, ImportHptDto, SearchDrugsQuery, SetPriceDto, UpdateDrugDto } from './formulary.dto';
import { FormularyService } from './formulary.service';

const READERS = [Role.PRESCRIBER, Role.PHARMACIST, Role.PHARMACY_TECHNICIAN, Role.STORE_KEEPER, Role.SYSTEM];

@ApiTags('formulary')
@Controller('formulary')
export class FormularyController {
  constructor(private readonly service: FormularyService) {}

  @Get('drugs')
  @Roles(...READERS)
  search(@Query() q: SearchDrugsQuery) {
    return this.service.search(q);
  }

  @Get('drugs/by-hpt/:hptCode')
  @Roles(...READERS)
  byHpt(@Param('hptCode') hptCode: string) {
    return this.service.getByHpt(hptCode);
  }

  @Get('drugs/:id')
  @Roles(...READERS)
  get(@Param('id') id: string) {
    return this.service.getDrug(id);
  }

  @Get('drugs/:id/versions')
  @Roles(Role.PHARMACIST)
  versions(@Param('id') id: string) {
    return this.service.versions(id);
  }

  @Get('drugs/:id/substitutes')
  @Roles(...READERS)
  substitutes(@Param('id') id: string) {
    return this.service.substitutes(id);
  }

  @Post('drugs')
  @Roles(Role.PHARMACIST)
  create(@Body() dto: CreateDrugDto, @CurrentActor() actor: Actor) {
    return this.service.createDrug(dto, actor);
  }

  @Patch('drugs/:id')
  @Roles(Role.PHARMACIST)
  update(@Param('id') id: string, @Body() dto: UpdateDrugDto, @CurrentActor() actor: Actor) {
    return this.service.updateDrug(id, dto, actor);
  }

  @Get('drugs/:id/prices')
  @Roles(Role.PHARMACIST, Role.SYSTEM)
  prices(@Param('id') id: string) {
    return this.service.prices(id);
  }

  @Post('drugs/:id/prices')
  @Roles(Role.PHARMACIST)
  setPrice(@Param('id') id: string, @Body() dto: SetPriceDto, @CurrentActor() actor: Actor) {
    return this.service.setPrice(id, dto, actor);
  }

  @Put('facilities/:facilityId/drugs/:drugId')
  @Roles(Role.PHARMACIST)
  setFacility(
    @Param('facilityId') facilityId: string,
    @Param('drugId') drugId: string,
    @Body() dto: FacilityFormularyDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.service.setFacilityEntry(facilityId, drugId, dto, actor);
  }

  @Post('code-sets/atc')
  @Roles(Role.ADMINISTRATOR)
  importAtc(@Body() dto: ImportAtcDto, @CurrentActor() actor: Actor) {
    return this.service.importAtc(dto, actor);
  }

  @Post('code-sets/hpt')
  @Roles(Role.ADMINISTRATOR)
  importHpt(@Body() dto: ImportHptDto, @CurrentActor() actor: Actor) {
    return this.service.importHpt(dto, actor);
  }
}
