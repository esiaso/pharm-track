import { IsDateString, IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAllergyDto {
  @IsString() patientId: string;
  @IsIn(['DRUG', 'DRUG_CLASS', 'NON_DRUG']) agentType: 'DRUG' | 'DRUG_CLASS' | 'NON_DRUG';
  /** For DRUG allergies, the drug's HPT code. */
  @IsOptional() @IsString() hptCode?: string;
  /** For DRUG_CLASS allergies (or to widen a DRUG allergy), an ATC prefix such as J01C. */
  @IsOptional() @IsString() atcPrefix?: string;
  @IsString() @MinLength(2) agentText: string;
  @IsOptional() @IsString() reaction?: string;
  @IsIn(['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING']) severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING';
  @IsOptional() @IsIn(['UNCONFIRMED', 'CONFIRMED', 'REFUTED']) verificationStatus?: 'UNCONFIRMED' | 'CONFIRMED' | 'REFUTED';
  /** Set when the record originates in CliniTrack (upsert key). */
  @IsOptional() @IsString() externalId?: string;
}

export class UpdateAllergyDto {
  @IsOptional() @IsIn(['UNCONFIRMED', 'CONFIRMED', 'REFUTED']) verificationStatus?: 'UNCONFIRMED' | 'CONFIRMED' | 'REFUTED';
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ENTERED_IN_ERROR']) status?: 'ACTIVE' | 'INACTIVE' | 'ENTERED_IN_ERROR';
  @IsOptional() @IsIn(['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING']) severity?: 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING';
  @IsOptional() @IsString() reaction?: string;
}

export enum AdrSeriousnessDto {
  NON_SERIOUS = 'NON_SERIOUS',
  SERIOUS_HOSPITALISATION = 'SERIOUS_HOSPITALISATION',
  SERIOUS_LIFE_THREATENING = 'SERIOUS_LIFE_THREATENING',
  SERIOUS_DISABILITY = 'SERIOUS_DISABILITY',
  SERIOUS_CONGENITAL_ANOMALY = 'SERIOUS_CONGENITAL_ANOMALY',
  SERIOUS_DEATH = 'SERIOUS_DEATH',
}
export enum AdrCausalityDto {
  UNASSESSED = 'UNASSESSED',
  CERTAIN = 'CERTAIN',
  PROBABLE = 'PROBABLE',
  POSSIBLE = 'POSSIBLE',
  UNLIKELY = 'UNLIKELY',
  CONDITIONAL = 'CONDITIONAL',
  UNASSESSABLE = 'UNASSESSABLE',
}
export enum AdrOutcomeDto {
  UNKNOWN = 'UNKNOWN',
  RECOVERED = 'RECOVERED',
  RECOVERING = 'RECOVERING',
  NOT_RECOVERED = 'NOT_RECOVERED',
  RECOVERED_WITH_SEQUELAE = 'RECOVERED_WITH_SEQUELAE',
  FATAL = 'FATAL',
}

export class CreateAdrDto {
  @IsString() patientId: string;
  @IsOptional() @IsString() encounterId?: string;
  @IsString() hptCode: string;
  @IsOptional() @IsString() dispenseLineId?: string;
  @IsDateString() onsetDate: string;
  @IsString() @MinLength(5) description: string;
  @IsEnum(AdrSeriousnessDto) seriousness: AdrSeriousnessDto;
  @IsOptional() @IsString() actionTaken?: string;
  @IsOptional() @IsEnum(AdrOutcomeDto) outcome?: AdrOutcomeDto;
}

export class AssessAdrDto {
  @IsEnum(AdrCausalityDto) causality: AdrCausalityDto;
  @IsOptional() @IsEnum(AdrOutcomeDto) outcome?: AdrOutcomeDto;
  @IsOptional() @IsString() actionTaken?: string;
}

export class MarkAdrSubmittedDto {
  @IsString() ppbReference: string;
}
