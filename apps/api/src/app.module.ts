import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './common/audit.service';
import { RolesGuard } from './common/auth';
import { DispensingModule } from './dispensing/dispensing.module';
import { FormularyModule } from './formulary/formulary.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { PrescriptionsModule } from './prescriptions/prescriptions.module';
import { PrismaModule } from './prisma/prisma.service';
import { RecordsModule } from './records/records.module';
import { RefillsModule } from './refills/refills.module';
import { ReportsModule } from './reports/reports.module';
import { SafetyModule } from './safety/safety.module';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'pharmtrack' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    IntegrationsModule,
    SafetyModule,
    FormularyModule,
    RecordsModule,
    PrescriptionsModule,
    RefillsModule,
    DispensingModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class AppModule {}
