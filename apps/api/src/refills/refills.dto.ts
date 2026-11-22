import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

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
  @IsString() name: string;
  @IsOptional() @IsString() phone?: string;
}

export class SmsTemplateDto {
  @IsOptional() @IsString() facilityId?: string;
  @IsIn(['REFILL_REMINDER', 'REFILL_DUE', 'REFILL_OVERDUE', 'READY_FOR_COLLECTION'])
  purpose: 'REFILL_REMINDER' | 'REFILL_DUE' | 'REFILL_OVERDUE' | 'READY_FOR_COLLECTION';
  @IsIn(['en', 'sw']) language: 'en' | 'sw';
  @IsString() @MinLength(10) body: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class DeliveryReportDto {
  @IsString() providerMessageId: string;
  @IsIn(['DELIVERED', 'FAILED']) status: 'DELIVERED' | 'FAILED';
  @IsOptional() @IsString() error?: string;
}
