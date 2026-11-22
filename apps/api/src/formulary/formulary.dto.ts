import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export enum FormularyStatusDto {
  ACTIVE = 'ACTIVE',
  RESTRICTED = 'RESTRICTED',
  NON_FORMULARY = 'NON_FORMULARY',
  DISCONTINUED = 'DISCONTINUED',
}
export enum ControlledScheduleDto {
  NONE = 'NONE',
  SCHEDULE_1 = 'SCHEDULE_1',
  SCHEDULE_2 = 'SCHEDULE_2',
  SCHEDULE_3 = 'SCHEDULE_3',
  SCHEDULE_4 = 'SCHEDULE_4',
  SCHEDULE_5 = 'SCHEDULE_5',
}
export enum ReproductiveRiskDto {
  UNKNOWN = 'UNKNOWN',
  SAFE = 'SAFE',
  CAUTION = 'CAUTION',
  AVOID = 'AVOID',
  CONTRAINDICATED = 'CONTRAINDICATED',
}

export class CreateDrugDto {
  @IsString() hptCode: string;
  @IsString() atcCode: string;
  @IsString() @MinLength(2) genericName: string;
  @IsOptional() @IsArray() @IsString({ each: true }) brandNames?: string[];
  @IsString() strength: string;
  @IsOptional() @IsNumber() strengthValue?: number;
  @IsOptional() @IsString() strengthUnit?: string;
  @IsString() dosageForm: string;
  @IsString() route: string;
  @IsInt() @IsPositive() packSize: number;
  @IsString() unitOfIssue: string;
  @IsOptional() @IsEnum(ControlledScheduleDto) controlledSchedule?: ControlledScheduleDto;
  @IsOptional() @IsEnum(FormularyStatusDto) formularyStatus?: FormularyStatusDto;
  @IsOptional() @IsEnum(ReproductiveRiskDto) pregnancyRisk?: ReproductiveRiskDto;
  @IsOptional() @IsEnum(ReproductiveRiskDto) lactationRisk?: ReproductiveRiskDto;
  @IsOptional() @IsString() substitutionGroupId?: string;
}

export class UpdateDrugDto {
  @IsOptional() @IsString() atcCode?: string;
  @IsOptional() @IsString() genericName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) brandNames?: string[];
  @IsOptional() @IsString() strength?: string;
  @IsOptional() @IsNumber() strengthValue?: number;
  @IsOptional() @IsString() strengthUnit?: string;
  @IsOptional() @IsString() dosageForm?: string;
  @IsOptional() @IsString() route?: string;
  @IsOptional() @IsInt() @IsPositive() packSize?: number;
  @IsOptional() @IsString() unitOfIssue?: string;
  @IsOptional() @IsEnum(ControlledScheduleDto) controlledSchedule?: ControlledScheduleDto;
  @IsOptional() @IsEnum(FormularyStatusDto) formularyStatus?: FormularyStatusDto;
  @IsOptional() @IsEnum(ReproductiveRiskDto) pregnancyRisk?: ReproductiveRiskDto;
  @IsOptional() @IsEnum(ReproductiveRiskDto) lactationRisk?: ReproductiveRiskDto;
  @IsOptional() @IsString() substitutionGroupId?: string | null;
  /** Why the change was made; stored on the version snapshot. */
  @IsString() @MinLength(3) reason: string;
}

export class SetPriceDto {
  @IsOptional() @IsString() priceListCode?: string;
  @IsNumber() @IsPositive() unitPrice: number;
  @IsOptional() @IsString() currency?: string;
  @IsDateString() effectiveFrom: string;
}

export class FacilityFormularyDto {
  @IsEnum(FormularyStatusDto) status: FormularyStatusDto;
  @IsOptional() @IsString() approvalRequiredBy?: string;
  @IsOptional() @IsString() restrictionNote?: string;
}

export class AtcRowDto {
  @IsString() code: string;
  @IsString() name: string;
  @IsOptional() @IsNumber() ddd?: number;
  @IsOptional() @IsString() dddUnit?: string;
  @IsOptional() @IsString() dddRoute?: string;
}

export class HptRowDto {
  @IsString() code: string;
  @IsString() description: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() ppbStatus?: string;
}

export class ImportAtcDto {
  @IsString() release: string;
  @IsArray() @ArrayMaxSize(20000) @ValidateNested({ each: true }) @Type(() => AtcRowDto) rows: AtcRowDto[];
}

export class ImportHptDto {
  @IsString() release: string;
  @IsArray() @ArrayMaxSize(50000) @ValidateNested({ each: true }) @Type(() => HptRowDto) rows: HptRowDto[];
}

export class SearchDrugsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() facilityId?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() includeInactive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}
