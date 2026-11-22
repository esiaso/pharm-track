import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { CodeSetCsvImportDto, DrugMasterImportDto, FacilityFormularyImportDto, ListRuleSetsQuery, RetireRuleSetDto, RuleSetImportDto, TemplateParams } from './content.dto';
import { ContentService } from './content.service';

/**
 * Clinical content management (phase 4): code-set releases, safety rule sets
 * with two-pharmacist approval, facility formularies and the drug master.
 * Every import accepts `dryRun: true` to see what would change first.
 */
@ApiTags('content')
@Controller('content')
export class ContentController {
  constructor(private readonly service: ContentService) {}

  @Get('templates/:kind')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  @Header('content-type', 'text/csv; charset=utf-8')
  template(@Param() p: TemplateParams, @Res({ passthrough: true }) res: Response) {
    res.setHeader('content-disposition', `attachment; filename="${p.kind}-template.csv"`);
    return this.service.template(p.kind);
  }

  // Code sets
  @Get('code-sets/imports')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  imports() {
    return this.service.listImports();
  }

  @Get('code-sets/imports/:id')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  importDetail(@Param('id') id: string) {
    return this.service.getImport(id);
  }

  @Get('code-sets/drugs-needing-review')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  drugsNeedingReview() {
    return this.service.drugsNeedingReview();
  }

  @Post('code-sets/atc/import')
  @Roles(Role.ADMINISTRATOR)
  importAtc(@Body() dto: CodeSetCsvImportDto, @CurrentActor() actor: Actor) {
    return this.service.importAtc(dto, actor);
  }

  @Post('code-sets/hpt/import')
  @Roles(Role.ADMINISTRATOR)
  importHpt(@Body() dto: CodeSetCsvImportDto, @CurrentActor() actor: Actor) {
    return this.service.importHpt(dto, actor);
  }

  // Safety rule sets
  @Get('rule-sets')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  ruleSets(@Query() q: ListRuleSetsQuery) {
    return this.service.listRuleSets(q);
  }

  @Post('rule-sets/import')
  @Roles(Role.PHARMACIST)
  importRuleSet(@Body() dto: RuleSetImportDto, @CurrentActor() actor: Actor) {
    return this.service.importRuleSet(dto, actor);
  }

  @Get('rule-sets/:id')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  ruleSet(@Param('id') id: string) {
    return this.service.getRuleSet(id);
  }

  @Get('rule-sets/:id/export')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  @Header('content-type', 'text/csv; charset=utf-8')
  async exportRuleSet(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.service.exportRuleSet(id);
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Post('rule-sets/:id/activate')
  @Roles(Role.PHARMACIST)
  activate(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.service.activateRuleSet(id, actor);
  }

  @Post('rule-sets/:id/retire')
  @Roles(Role.PHARMACIST)
  retire(@Param('id') id: string, @Body() dto: RetireRuleSetDto, @CurrentActor() actor: Actor) {
    return this.service.retireRuleSet(id, dto, actor);
  }

  // Facility formulary
  @Get('facilities/:facilityId/formulary/export')
  @Roles(Role.PHARMACIST, Role.ADMINISTRATOR)
  @Header('content-type', 'text/csv; charset=utf-8')
  async exportFormulary(@Param('facilityId') facilityId: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('content-disposition', `attachment; filename="formulary-${facilityId.replace(/[^A-Za-z0-9.-]+/g, '-')}.csv"`);
    return this.service.exportFacilityFormulary(facilityId);
  }

  @Post('facilities/:facilityId/formulary/import')
  @Roles(Role.PHARMACIST)
  importFormulary(@Param('facilityId') facilityId: string, @Body() dto: FacilityFormularyImportDto, @CurrentActor() actor: Actor) {
    return this.service.importFacilityFormulary(facilityId, dto, actor);
  }

  // Drug master
  @Post('drugs/import')
  @Roles(Role.PHARMACIST)
  importDrugs(@Body() dto: DrugMasterImportDto, @CurrentActor() actor: Actor) {
    return this.service.importDrugs(dto, actor);
  }
}
