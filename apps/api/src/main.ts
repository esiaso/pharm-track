import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export async function createApp() {
  if (process.env.NODE_ENV === 'production' && (process.env.AUTH_MODE ?? 'dev-headers') === 'dev-headers') {
    throw new Error('AUTH_MODE=dev-headers is not allowed in production. Configure SynergyOne SSO.');
  }
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const config = new DocumentBuilder()
    .setTitle('PharmTrack API')
    .setDescription('SynergyOne pharmacy module: formulary (WHO ATC + PPB HPT), medication safety, dispensing, refills.')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) void bootstrap();
