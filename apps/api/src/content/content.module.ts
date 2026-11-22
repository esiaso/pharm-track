import { Module } from '@nestjs/common';
import { FormularyModule } from '../formulary/formulary.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({ imports: [FormularyModule], controllers: [ContentController], providers: [ContentService], exports: [ContentService] })
export class ContentModule {}
