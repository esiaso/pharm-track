import { RefillStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RequestRefillDto {
  @IsOptional() @IsIn(['STAT', 'URGENT', 'ROUTINE']) priority?: 'STAT' | 'URGENT' | 'ROUTINE';
  /** Store to fill from; defaults to the original prescription's store. */
  @IsOptional() @IsString() storeId?: string;
}

export class ContactPreferenceDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsBoolean() smsOptIn: boolean;
  @IsOptional() @IsIn(['en', 'sw']) language?: 'en' | 'sw';
}

export class FacilityProfileDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  /** Lets a consultant authorise overriding a hard-stop safety alert. */
  @IsOptional() @IsBoolean() allowHardStopOverride?: boolean;
}

export class SmsTemplateDto {
  @IsOptional() @IsString() facilityId?: string;
  @IsIn(['REFILL_REMINDER', 'REFILL_DUE', 'REFILL_OVERDUE', 'READY_FOR_COLLECTION'])
  purpose: 'REFILL_REMINDER' | 'REFILL_DUE' | 'REFILL_OVERDUE' | 'READY_FOR_COLLECTION';
  @IsIn(['en', 'sw']) language: 'en' | 'sw';
  @IsString() @MinLength(10) @MaxLength(480) body: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class DeliveryReportDto {
  @IsString() providerMessageId: string;
  @IsIn(['DELIVERED', 'FAILED']) status: 'DELIVERED' | 'FAILED';
  @IsOptional() @IsString() error?: string;
}

export class RefillListQuery {
  @IsOptional() @IsString() facilityId?: string;
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsEnum(RefillStatus) status?: RefillStatus;
  /** Page size, 1 to 500. Default 500. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  /** Rows to skip, for paging. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
