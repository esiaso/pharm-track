import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RefillsController } from './refills.controller';
import { RefillsService } from './refills.service';

@Module({ controllers: [RefillsController], providers: [RefillsService, NotificationsService], exports: [RefillsService, NotificationsService] })
export class RefillsModule {}
