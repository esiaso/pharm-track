import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { checkConfig } from './common/config-check';
import { apiDocsEnabled, bodyParsers, RateLimiter, rateLimitFromEnv, securityHeaders } from './common/hardening';

export async function createApp() {
  const settings = checkConfig();
  const log = new Logger('Config');
  for (const w of settings.warnings) log.warn(w);
  if (settings.errors.length) {
    if (process.env.NODE_ENV === 'production') throw new Error(`PharmTrack will not start:\n- ${settings.errors.join('\n- ')}`);
    for (const e of settings.errors) log.error(e);
  }
  // Body parsing is set up below, with a smaller limit outside content imports.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable('x-powered-by');
  app.enableShutdownHooks(); // finish in-flight requests and close the database pool on SIGTERM
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
  app.use(securityHeaders({ hsts: process.env.NODE_ENV === 'production' && !!process.env.TRUST_PROXY }));
  const perMinute = rateLimitFromEnv(process.env);
  if (perMinute > 0) app.use(new RateLimiter(perMinute).middleware());
  // JSON up to 1 MB; content imports send whole code lists, so they get 25 MB.
  for (const parser of bodyParsers()) app.use(parser);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (apiDocsEnabled(process.env)) {
    const config = new DocumentBuilder()
      .setTitle('PharmTrack API')
      .setDescription('SynergyOne pharmacy module: formulary (WHO ATC + PPB HPT), medication safety, dispensing, refills.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) void bootstrap();
