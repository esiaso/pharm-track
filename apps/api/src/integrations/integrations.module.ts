import { Global, Module } from '@nestjs/common';
import { ClinitrackClient, HttpClinitrackClient } from './clinitrack.client';
import { OutboxService } from './outbox.service';
import { HttpSmsProvider, LogSmsProvider, SmsProvider } from './sms.provider';
import { HttpSupplyTrackClient, SupplyTrackClient } from './supplytrack.client';

@Global()
@Module({
  providers: [
    { provide: SupplyTrackClient, useClass: HttpSupplyTrackClient },
    { provide: ClinitrackClient, useClass: HttpClinitrackClient },
    { provide: SmsProvider, useClass: process.env.SMS_PROVIDER === 'http' ? HttpSmsProvider : LogSmsProvider },
    OutboxService,
  ],
  exports: [SupplyTrackClient, ClinitrackClient, SmsProvider, OutboxService],
})
export class IntegrationsModule {}
