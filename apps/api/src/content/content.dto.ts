import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CONTENT_KINDS, ContentKind } from '../domain/content';

export enum ImportModeDto {
  FULL = 'FULL',
  PARTIAL = 'PARTIAL',
}
export enum RuleKindDto {
  INTERACTION = 'INTERACTION',
  CONTRAINDICATION = 'CONTRAINDICATION',
  DOSE_LIMIT = 'DOSE_LIMIT',
}

/** 20 MB of CSV text: the full WHO ATC/DDD index is well under 1 MB. */
const MAX_CSV = 20_000_000;

class CsvBody {
  /** File contents (CSV, comma, semicolon or tab separated, UTF-8). */
  @IsString() @MinLength(1) @MaxLength(MAX_CSV) csv: string;
  /** Validate and report what would change, without writing anything. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class CodeSetCsvImportDto extends CsvBody {
  /** e.g. "WHO-ATC-2026" or "PPB-HPT-2026-11". */
  @IsString() @MinLength(2) release: string;
  /** FULL marks codes missing from this release as retired. Default PARTIAL. */
  @IsOptional() @IsEnum(ImportModeDto) mode?: ImportModeDto;
  /** Needed when a FULL release would retire more than a quarter of the loaded codes (usually a sign of the wrong file). */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class RuleSetImportDto extends CsvBody {
  @IsEnum(RuleKindDto) kind: RuleKindDto;
  @IsString() @MinLength(2) name: string;
  /** Where the rules come from, e.g. "Facility MTC" or a knowledge base name. Activating a set retires the previous active set of the same kind and source. */
  @IsString() @MinLength(2) source: string;
  @IsString() @MinLength(1) version: string;
  @IsOptional() @IsString() notes?: string;
}

export class RetireRuleSetDto {
  @IsString() @MinLength(5) reason: string;
}

export class FacilityFormularyImportDto extends CsvBody {
  /** FULL removes this facility's entries that are not in the file (they fall back to the suite-wide status). */
  @IsOptional() @IsEnum(ImportModeDto) mode?: ImportModeDto;
}

export class DrugMasterImportDto extends CsvBody {
  /** Recorded on each drug's version history. */
  @IsString() @MinLength(3) reason: string;
}

export class TemplateParams {
  @IsIn(CONTENT_KINDS) kind: ContentKind;
}

export class ListRuleSetsQuery {
  @IsOptional() @IsEnum(RuleKindDto) kind?: RuleKindDto;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'RETIRED']) status?: 'DRAFT' | 'ACTIVE' | 'RETIRED';
}
