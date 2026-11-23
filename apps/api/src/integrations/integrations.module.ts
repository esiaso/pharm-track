import { Global, Module } from '@nestjs/common';
import { ClinitrackClient, HttpClinitrackClient } from './clinitrack.client';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { OutboxService } from './outbox.service';
import { AfricasTalkingSmsProvider, HttpSmsProvider, LogSmsProvider, SmsProvider } from './sms.provider';
import { HttpSupplyTrackClient, SupplyTrackClient } from './supplytrack.client';

@Global()
@Module({
  providers: [
    { provide: SupplyTrackClient, useClass: HttpSupplyTrackClient },
    { provide: ClinitrackClient, useClass: HttpClinitrackClient },
    {
      provide: SmsProvider,
      useFactory: () =>
        process.env.SMS_PROVIDER === 'http'
          ? new HttpSmsProvider()
          : process.env.SMS_PROVIDER === 'africastalking'
            ? new AfricasTalkingSmsProvider(process.env)
            : new LogSmsProvider(),
    },
    OutboxService,
    IntegrationsService,
  ],
  controllers: [IntegrationsController],
  exports: [SupplyTrackClient, ClinitrackClient, SmsProvider, OutboxService, IntegrationsService],
})
export class IntegrationsModule {}
