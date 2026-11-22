import { Module } from '@nestjs/common';
import { FormularyController } from './formulary.controller';
import { FormularyService } from './formulary.service';

@Module({ controllers: [FormularyController], providers: [FormularyService], exports: [FormularyService] })
export class FormularyModule {}
