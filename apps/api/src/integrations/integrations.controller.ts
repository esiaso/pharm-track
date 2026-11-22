import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor, CurrentActor, Role, Roles } from '../common/auth';
import { SupplyTrackEventDto } from './integrations.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get('summary')
  @Roles(Role.PHARMACIST)
  summary() {
    return this.service.summary();
  }

  @Get('outbox')
  @Roles(Role.PHARMACIST)
  outbox(@Query('status') status?: string, @Query('destination') destination?: string, @Query('type') type?: string) {
    return this.service.listOutbox({ status, destination, type });
  }

  @Post('outbox/:id/retry')
  @HttpCode(200)
  @Roles(Role.ADMINISTRATOR)
  retry(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.service.retry(id, actor);
  }

  /** SupplyTrack pushes batch recalls and stock status here. */
  @Post('supplytrack/events')
  @HttpCode(200)
  @Roles(Role.SYSTEM)
  supplytrack(@Body() dto: SupplyTrackEventDto, @CurrentActor() actor: Actor) {
    return this.service.handleSupplyTrackEvent(dto, actor);
  }

  @Get('recalls')
  @Roles(Role.PHARMACIST, Role.PHARMACY_TECHNICIAN)
  recalls(@Query('open') open?: string) {
    return this.service.listRecalls(open === 'true');
  }

  @Get('recalls/:id')
  @Roles(Role.PHARMACIST, Role.PHARMACY_TECHNICIAN)
  recall(@Param('id') id: string) {
    return this.service.getRecall(id);
  }

  @Post('recalls/:id/acknowledge')
  @HttpCode(200)
  @Roles(Role.PHARMACIST)
  acknowledge(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.service.acknowledgeRecall(id, actor);
  }

  @Get('stock-alerts')
  @Roles(Role.PHARMACIST, Role.PHARMACY_TECHNICIAN, Role.STORE_KEEPER)
  stock(@Query('storeId') storeId?: string) {
    return this.service.listStockAlerts(storeId);
  }
}
