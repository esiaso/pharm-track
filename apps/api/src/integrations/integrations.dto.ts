
import { IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class BatchRecalledPayload {
  @IsString() hptCode: string;
  @IsString() batchNumber: string;
  @IsString() reason: string;
  @IsOptional() @IsString() recallClass?: string;
  @IsOptional() @IsString() reference?: string;
}

export class StockStatusPayload {
  @IsString() storeId: string;
  @IsString() hptCode: string;
  @IsOptional() @IsNumber() quantity?: number;
}

/** Event pushed by SupplyTrack. Contract: docs/api/supplytrack-contract.md and docs/api/events. */
export class SupplyTrackEventDto {
  @IsIn(['batch.recalled', 'stock.low', 'stock.out', 'stock.restored']) type: 'batch.recalled' | 'stock.low' | 'stock.out' | 'stock.restored';
  @IsOptional() @IsString() occurredAt?: string;
  @IsObject() payload: Record<string, unknown>;
}

export class AcknowledgeRecallDto {
  @IsOptional() @IsString() note?: string;
}

