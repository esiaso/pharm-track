import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { checkConfig } from './common/config-check';

export async function createApp() {
  const settings = checkConfig();
  const log = new Logger('Config');
  for (const w of settings.warnings) log.warn(w);
  if (settings.errors.length) {
    if (process.env.NODE_ENV === 'production') throw new Error(`PharmTrack will not start:\n- ${settings.errors.join('\n- ')}`);
    for (const e of settings.errors) log.error(e);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks(); // finish in-flight requests and close the database pool on SIGTERM
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
  // Content imports send whole CSV files (the WHO ATC/DDD index is under 1 MB; HPT lists can be larger).
  app.useBodyParser('json', { limit: '25mb' });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const config = new DocumentBuilder()
    .setTitle('PharmTrack API')
    .setDescription('SynergyOne pharmacy module: formulary (WHO ATC + PPB HPT), medication safety, dispensing, refills.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) void bootstrap();
