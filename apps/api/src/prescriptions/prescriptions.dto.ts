import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClinicalContextDto, OverrideDto } from '../safety/safety.dto';

export class PrescriptionItemDto {
  /** CliniTrack's line reference; alerts and overrides use it. */
  @IsString() ref: string;
  @IsString() hptCode: string;
  /** Sent by CliniTrack for cross-checking against the drug master. */
  @IsString() atcCode: string;
  @IsNumber() @IsPositive() dose: number;
  @IsString() doseUnit: string;
  @IsString() frequency: string;
  @IsNumber() @IsPositive() frequencyPerDay: number;
  @IsString() route: string;
  @IsInt() @Min(1) durationDays: number;
  /** Quantity per fill, in the drug's unit of issue. */
  @IsNumber() @IsPositive() quantity: number;
  @IsOptional() @IsInt() @Min(0) @Max(12) refills?: number;
  @IsOptional() @IsString() instructions?: string;
}

/** A prescription signed on CliniTrack's prescription pad. */
export class SignedPrescriptionDto {
  @IsString() externalId: string;
  @IsString() patientId: string;
  @IsString() encounterId: string;
  @IsString() prescriberId: string;
  @IsString() facilityId: string;
  /** Pharmacy store that should fill it. */
  @IsString() storeId: string;
  @IsDateString() signedAt: string;
  @IsOptional() @IsIn(['STAT', 'URGENT', 'ROUTINE']) priority?: 'STAT' | 'URGENT' | 'ROUTINE';
  /** How long refills stay valid, in days from signing. Default 180. */
  @IsOptional() @IsInt() @Min(1) @Max(365) refillValidityDays?: number;
  @ValidateNested() @Type(() => ClinicalContextDto) context: ClinicalContextDto;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PrescriptionItemDto) items: PrescriptionItemDto[];
  /** Prescriber overrides for WARNING alerts, keyed by alert key. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OverrideDto) overrides?: OverrideDto[];
}

export class CancelDto {
  @IsString() @MinLength(3) reason: string;
}
