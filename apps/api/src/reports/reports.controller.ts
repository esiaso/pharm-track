import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { PatientData } from '../common/patient-access';
import { AdrBatchDto, GenerateReportDto, ListRunsQuery, PeriodQuery, StockOutQuery, SubmitReportDto } from './reports.dto';
import { consumptionCsv, prescribingCsv, ReportsService, stockOutCsv } from './reports.service';

function period(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
  return { from: start, to: end };
}

/** Sends `csv` as a download when asked for, otherwise the JSON body. */
function maybeCsv<T>(res: Response, format: string | undefined, filename: string, body: T, toCsv: (b: T) => string) {
  if (format !== 'csv') return body;
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  return toCsv(body);
}

@ApiTags('reports')
@Controller('reports')
@Roles(Role.PHARMACIST, Role.SYSTEM)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('consumption')
  async consumption(@Query() q: PeriodQuery, @Res({ passthrough: true }) res: Response) {
    return maybeCsv(res, q.format, 'consumption.csv', await this.service.consumption({ facilityId: q.facilityId, ...period(q.from, q.to) }), consumptionCsv);
  }

  @Get('antimicrobial-use')
  antimicrobial(@Query() q: PeriodQuery) {
    return this.service.antimicrobialUse({ facilityId: q.facilityId, ...period(q.from, q.to) });
  }

  @Get('refills')
  refills(@Query('facilityId') facilityId?: string) {
    return this.service.refillSummary(facilityId);
  }

  @Get('safety-overrides')
  overrides(@Query() q: PeriodQuery) {
    return this.service.overrides(period(q.from, q.to));
  }

  @Get('prescribing')
  async prescribing(@Query() q: PeriodQuery, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.prescribing({ facilityId: q.facilityId, ...period(q.from, q.to) });
    return maybeCsv(res, q.format, 'prescribing-indicators.csv', r, (b) => prescribingCsv(b.prescribers as never));
  }

  @Get('stock-outs')
  async stockOuts(@Query() q: StockOutQuery, @Res({ passthrough: true }) res: Response) {
    return maybeCsv(res, q.format, 'stock-outs.csv', await this.service.stockOuts({ facilityId: q.facilityId, storeId: q.storeId, ...period(q.from, q.to) }), stockOutCsv);
  }

  // ADR reporting to PPB
  @Get('adrs/ppb-queue')
  @PatientData('adrs.ppb-queue')
  @Roles(Role.PHARMACIST)
  adrQueue() {
    return this.service.adrQueue();
  }

  @Post('adrs/ppb-batch')
  @PatientData('adrs.ppb-batch')
  @Roles(Role.PHARMACIST)
  adrBatch(@Body() dto: AdrBatchDto, @CurrentActor() actor: Actor) {
    return this.service.adrBatch(dto.adrIds, actor);
  }

  // Monthly report runs
  @Get('runs')
  runs(@Query() q: ListRunsQuery) {
    return this.service.listRuns(q);
  }

  @Post('runs')
  @Roles(Role.PHARMACIST)
  generate(@Body() dto: GenerateReportDto, @CurrentActor() actor: Actor) {
    return this.service.generate(dto.kind, dto.facilityId, dto.period, actor);
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  @Get('runs/:id/csv')
  async runCsv(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.service.runCsv(id);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Post('runs/:id/submit')
  @Roles(Role.PHARMACIST)
  submit(@Param('id') id: string, @Body() dto: SubmitReportDto, @CurrentActor() actor: Actor) {
    return this.service.submit(id, !!dto.acknowledgeWarnings, actor);
  }

  @Delete('runs/:id')
  @Roles(Role.PHARMACIST)
  discard(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.service.discard(id, actor);
  }
}
