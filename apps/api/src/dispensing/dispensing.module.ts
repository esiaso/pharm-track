import { Module } from '@nestjs/common';
import { FormularyModule } from '../formulary/formulary.module';
import { RefillsModule } from '../refills/refills.module';
import { DispensingController } from './dispensing.controller';
import { DispensingService } from './dispensing.service';
import { LabelsService } from './labels.service';

@Module({ imports: [FormularyModule, RefillsModule], controllers: [DispensingController], providers: [DispensingService, LabelsService] })
export class DispensingModule {}
