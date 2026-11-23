import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
