import { Injectable } from '@nestjs/common';
import type { BatchAllocation, StockBatch } from '../domain/dispensing';
import { callJson } from './http';

/**
 * Client for SupplyTrack (stock, batches, stores). Contract: docs/api/supplytrack-contract.md.
 * Drugs are identified by PPB HPT code.
 */
export abstract class SupplyTrackClient {
  abstract getBatches(storeId: string, hptCode: string): Promise<StockBatch[]>;
  /** Reserves the allocations. Returns SupplyTrack's reservation id. Idempotent on the key. */
  abstract reserve(req: {
    storeId: string;
    hptCode: string;
    allocations: BatchAllocation[];
    reference: string;
    idempotencyKey: string;
  }): Promise<{ reservationId: string; expiresAt: string }>;
  /** Deducts reserved stock (dispensed). */
  abstract commit(reservationId: string, idempotencyKey: string): Promise<void>;
  abstract release(reservationId: string, idempotencyKey: string): Promise<void>;
  /** Restocks returned medicine into a batch. */
  abstract returnStock(req: {
    storeId: string;
    hptCode: string;
    batchNumber: string;
    quantity: number;
    reason: string;
    reference: string;
    idempotencyKey: string;
  }): Promise<void>;
}

interface BatchDto {
  batchNumber: string;
  expiryDate: string;
  quantityAvailable: number;
}

@Injectable()
export class HttpSupplyTrackClient extends SupplyTrackClient {
  private readonly base = process.env.SUPPLYTRACK_BASE_URL ?? 'http://localhost:5000/api/v1';
  private readonly token = process.env.SUPPLYTRACK_TOKEN;

  async getBatches(storeId: string, hptCode: string): Promise<StockBatch[]> {
    const res = await callJson<{ batches: BatchDto[] }>(
      this.base,
      'GET',
      `/stores/${encodeURIComponent(storeId)}/items/${encodeURIComponent(hptCode)}/batches`,
      { token: this.token },
    );
    return res.batches.map((b) => ({ ...b, expiryDate: new Date(b.expiryDate) }));
  }

  reserve(req: Parameters<SupplyTrackClient['reserve']>[0]) {
    const { idempotencyKey, allocations, ...rest } = req;
    return callJson<{ reservationId: string; expiresAt: string }>(this.base, 'POST', '/reservations', {
      idempotencyKey,
      token: this.token,
      body: {
        ...rest,
        lines: allocations.map((a) => ({
          batchNumber: a.batchNumber,
          expiryDate: a.expiryDate.toISOString().slice(0, 10),
          quantity: a.quantity,
        })),
      },
    });
  }

  async commit(reservationId: string, idempotencyKey: string) {
    await callJson(this.base, 'POST', `/reservations/${encodeURIComponent(reservationId)}/commit`, {
      idempotencyKey,
      token: this.token,
    });
  }

  async release(reservationId: string, idempotencyKey: string) {
    await callJson(this.base, 'POST', `/reservations/${encodeURIComponent(reservationId)}/release`, {
      idempotencyKey,
      token: this.token,
    });
  }

  async returnStock(req: Parameters<SupplyTrackClient['returnStock']>[0]) {
    const { idempotencyKey, ...body } = req;
    await callJson(this.base, 'POST', '/stock/returns', { idempotencyKey, token: this.token, body });
  }
}
