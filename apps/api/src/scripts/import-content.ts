/**
 * Command-line import for large content files, using the same validation and
 * rules as the API (dry run, full releases, rule sets saved as drafts).
 *
 *   npm run content:import -w apps/api -- atc ./ATC_DDD_2026.csv --release WHO-ATC-2026 --mode FULL --dry-run
 *   npm run content:import -w apps/api -- hpt ./hpt.csv --release PPB-HPT-2026-11 --mode FULL
 *   npm run content:import -w apps/api -- interactions ./ddi.csv --source "Facility MTC" --name "MTC interactions" --version 2026.1
 *   npm run content:import -w apps/api -- facility-formulary ./fac1.csv --facility FAC-1 --mode FULL
 *   npm run content:import -w apps/api -- drugs ./master.csv --reason "Annual review"
 *
 * Always pass --user (recorded in the audit log). Rule sets are saved as drafts;
 * a second pharmacist activates them in the web app. Exit code 1 on any error row.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AuditModule } from '../common/audit.service';
import { Actor, Role } from '../common/roles';
import { ContentModule } from '../content/content.module';
import { ContentService } from '../content/content.service';
import { ImportModeDto, RuleKindDto } from '../content/content.dto';
import { CONTENT_KINDS, ContentKind } from '../domain/content';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PrismaModule } from '../prisma/prisma.service';

/** No ScheduleModule: the outbox and reminder jobs do not run inside the CLI. */
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuditModule, IntegrationsModule, ContentModule] })
class CliModule {}

const RULE_KINDS: Partial<Record<ContentKind, RuleKindDto>> = {
  interactions: RuleKindDto.INTERACTION,
  contraindications: RuleKindDto.CONTRAINDICATION,
  'dose-limits': RuleKindDto.DOSE_LIMIT,
};

export function parseArgs(argv: string[]) {
  const [kind, file, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) throw new Error(`Unexpected argument "${a}"`);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  if (!kind || !CONTENT_KINDS.includes(kind as ContentKind)) throw new Error(`First argument must be one of: ${CONTENT_KINDS.join(', ')}`);
  if (!file) throw new Error('Second argument must be the CSV file path');
  const str = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  const need = (k: string) => {
    const v = str(k);
    if (!v) throw new Error(`--${k} is required for ${kind}`);
    return v;
  };
  return { kind: kind as ContentKind, file, flags, str, need };
}

async function main() {
  const { kind, file, flags, str, need } = parseArgs(process.argv.slice(2));
  const user = need('user');
  const actor: Actor = { id: `cli:${user}`, roles: [Role.ADMINISTRATOR, Role.PHARMACIST] };
  const csv = readFileSync(file, 'utf8');
  const dryRun = flags['dry-run'] === true;
  const mode = str('mode')?.toUpperCase() === 'FULL' ? ImportModeDto.FULL : ImportModeDto.PARTIAL;

  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error', 'warn'] });
  try {
    const content = app.get(ContentService);
    let result: { failed: number; errors: { line: number; message: string }[] } & Record<string, unknown>;
    if (kind === 'atc') result = await content.importAtc({ csv, release: need('release'), mode, dryRun, force: flags.force === true }, actor);
    else if (kind === 'hpt') result = await content.importHpt({ csv, release: need('release'), mode, dryRun, force: flags.force === true }, actor);
    else if (kind === 'facility-formulary') result = await content.importFacilityFormulary(need('facility'), { csv, mode, dryRun }, actor);
    else if (kind === 'drugs') result = await content.importDrugs({ csv, reason: need('reason'), dryRun }, actor);
    else result = await content.importRuleSet({ csv, kind: RULE_KINDS[kind]!, source: need('source'), name: need('name'), version: need('version'), notes: str('notes'), dryRun }, actor);

    const { errors, ...summary } = result;
    console.log(JSON.stringify({ ...summary, errors: errors.slice(0, 50), moreErrors: Math.max(0, errors.length - 50) }, null, 2));
    if (dryRun) console.log('\nDry run: nothing was written.');
    process.exitCode = result.failed ? 1 : 0;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const body = (e as { response?: unknown }).response;
    console.error(body ? JSON.stringify(body, null, 2) : e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
