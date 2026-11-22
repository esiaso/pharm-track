import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { OverrideDto } from '../safety/safety.dto';

export class VerifyDto {
  /** Pharmacist overrides for WARNING alerts raised at verification. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OverrideDto) overrides?: OverrideDto[];
}

export class DispenseLineRequestDto {
  @IsString() prescriptionItemId: string;
  @IsNumber() @IsPositive() quantity: number;
  /** HPT code of a generic substitute from the same substitution group. */
  @IsOptional() @IsString() substituteHptCode?: string;
  @IsOptional() @IsString() @MinLength(5) substitutionNote?: string;
  @IsOptional() @IsString() labelText?: string;
  @IsOptional() @IsString() counsellingNotes?: string;
  /** Second signatory for controlled drugs. Must differ from the dispenser. */
  @IsOptional() @IsString() witnessedBy?: string;
}

export class DispenseDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DispenseLineRequestDto) lines: DispenseLineRequestDto[];
  /** Price list CliniTrack should bill against (e.g. SHA). Defaults to DEFAULT. */
  @IsOptional() @IsString() priceListCode?: string;
}

export class ReturnDto {
  @IsNumber() @IsPositive() quantity: number;
  @IsString() @MinLength(3) reason: string;
}

export class BillingStatusLineDto {
  @IsString() dispenseLineId: string;
  @IsString() billingRef: string;
  @IsIn(['BILLED', 'REVERSED', 'FAILED']) status: 'BILLED' | 'REVERSED' | 'FAILED';
}

export class BillingStatusDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => BillingStatusLineDto) lines: BillingStatusLineDto[];
}

export class LabelRequestDto {
  /** Only these dispensed lines; default all lines on the order. */
  @IsOptional() @IsArray() @IsString({ each: true }) lineIds?: string[];
  /** Patient name to print (PharmTrack holds only the CliniTrack patient id). */
  @IsOptional() @IsString() @MaxLength(60) patientName?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) copies?: number;
}

export class LabelQuery {
  /** Comma-separated dispense line ids; default all lines on the order. */
  @IsOptional() @IsString() lineIds?: string;
  @IsOptional() @IsString() @MaxLength(60) patientName?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) copies?: number;
}
