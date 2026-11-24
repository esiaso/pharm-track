import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class PeriodQuery {
  @IsOptional() @IsString() facilityId?: string;
  /** ISO date-time; defaults to 30 days before `to`. */
  @IsOptional() @IsDateString() from?: string;
  /** ISO date-time; defaults to now. */
  @IsOptional() @IsDateString() to?: string;
  /** csv returns the main table as a CSV file. */
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}

export class StockOutQuery extends PeriodQuery {
  @IsOptional() @IsString() storeId?: string;
}

/** Paging for report tables. Totals and CSV downloads always cover every row. */
export class PagedPeriodQuery extends PeriodQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class ControlledRegisterQuery extends PagedPeriodQuery {
  @IsOptional() @IsString() storeId?: string;
  @IsOptional() @IsString() drugId?: string;
}

export class GenerateReportDto {
  @IsIn(['PHARMACY_RETURN', 'STOCK_OUT']) kind: 'PHARMACY_RETURN' | 'STOCK_OUT';
  @IsString() facilityId: string;
  /** Calendar month in Nairobi time, e.g. "2026-11". */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must look like 2026-11' }) period: string;
}

export class SubmitReportDto {
  /** Needed when the report has data-quality warnings. */
  @IsOptional() @IsBoolean() acknowledgeWarnings?: boolean;
}

export class ListRunsQuery {
  @IsOptional() @IsIn(['PHARMACY_RETURN', 'STOCK_OUT']) kind?: 'PHARMACY_RETURN' | 'STOCK_OUT';
  @IsOptional() @IsString() facilityId?: string;
}

export class AdrBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) adrIds: string[];
}
