/** Writes the OpenAPI document to docs/api/openapi.json without starting the server or a database. */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, preview: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const config = new DocumentBuilder().setTitle('PharmTrack API').setVersion('1.0').build();
  const doc = SwaggerModule.createDocument(app, config);
  const out = resolve(__dirname, '../../../../docs/api/openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Wrote ${out} (${Object.keys(doc.paths).length} paths)`);
  process.exit(0);
}
void main();
