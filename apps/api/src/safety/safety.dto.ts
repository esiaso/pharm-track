import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, ValidateNested } from 'class-validator';

export class DiagnosisDto {
  @IsIn(['ICD10', 'ICD11']) system: 'ICD10' | 'ICD11';
  @IsString() code: string;
}

/** Clinical context CliniTrack sends with a check or a signed prescription. */
export class ClinicalContextDto {
  @IsOptional() @IsNumber() ageMonths?: number;
  @IsOptional() @IsNumber() weightKg?: number;
  @IsOptional() @IsBoolean() pregnant?: boolean;
  @IsOptional() @IsBoolean() lactating?: boolean;
  @IsOptional() @IsNumber() crClMlMin?: number;
  @IsOptional() @IsBoolean() hepaticImpairment?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DiagnosisDto) diagnoses?: DiagnosisDto[];
}

export class CheckItemDto {
  /** Caller's reference for the line (echoed on alerts). */
  @IsString() ref: string;
  /** PPB HPT code: the drug's primary identifier. */
  @IsString() hptCode: string;
  @IsNumber() @IsPositive() dose: number;
  @IsString() doseUnit: string;
  @IsNumber() @IsPositive() frequencyPerDay: number;
  @IsString() route: string;
}

export class SafetyCheckDto {
  @IsString() patientId: string;
  @IsOptional() @IsString() facilityId?: string;
  @ValidateNested() @Type(() => ClinicalContextDto) context: ClinicalContextDto;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CheckItemDto) items: CheckItemDto[];
}

export class OverrideDto {
  @IsString() key: string;
  @IsString() @MaxLength(500) reason: string;
  /** For a hard stop: the consultant who authorised the override (only where the facility allows it). */
  @IsOptional() @IsString() @MaxLength(80) authorisedBy?: string;
}
