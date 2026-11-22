/** Dispense order state machine and FEFO batch allocation. */

export type DispenseStatus =
  | 'PENDING'
  | 'IN_VERIFICATION'
  | 'VERIFIED'
  | 'PARTIALLY_DISPENSED'
  | 'DISPENSED'
  | 'CANCELLED'
  | 'RETURNED';

const TRANSITIONS: Record<DispenseStatus, DispenseStatus[]> = {
  PENDING: ['IN_VERIFICATION', 'CANCELLED'],
  IN_VERIFICATION: ['VERIFIED', 'PENDING', 'CANCELLED'],
  VERIFIED: ['PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED'],
  PARTIALLY_DISPENSED: ['PARTIALLY_DISPENSED', 'DISPENSED', 'RETURNED'],
  DISPENSED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
};

export function canTransition(from: DispenseStatus, to: DispenseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DispenseStatus, to: DispenseStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: DispenseStatus,
    readonly to: DispenseStatus,
  ) {
    super(`Cannot move a dispense order from ${from} to ${to}.`);
  }
}

/** A batch as reported by SupplyTrack for a store. */
export interface StockBatch {
  batchNumber: string;
  expiryDate: Date;
  quantityAvailable: number;
}

export interface BatchAllocation {
  batchNumber: string;
  expiryDate: Date;
  quantity: number;
}

export interface FefoResult {
  allocations: BatchAllocation[];
  allocated: number;
  shortfall: number;
}

/**
 * First-expiry-first-out allocation. Skips batches that are expired, or that
 * expire before the course would be finished plus a safety margin.
 */
export function allocateFefo(
  batches: StockBatch[],
  quantity: number,
  opts: { today?: Date; minDaysToExpiry?: number } = {},
): FefoResult {
  const today = startOfDay(opts.today ?? new Date());
  const minExpiry = addDays(today, opts.minDaysToExpiry ?? 0);
  const usable = batches
    .filter((b) => b.quantityAvailable > 0 && startOfDay(b.expiryDate) > minExpiry)
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || a.batchNumber.localeCompare(b.batchNumber));

  const allocations: BatchAllocation[] = [];
  let remaining = quantity;
  for (const b of usable) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantityAvailable, remaining);
    allocations.push({ batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: take });
    remaining -= take;
  }
  return { allocations, allocated: quantity - remaining, shortfall: remaining };
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

/** Order status after dispensing, given how much of each item has been supplied. */
export function statusAfterDispense(items: { ordered: number; dispensed: number }[]): DispenseStatus {
  const complete = items.every((i) => i.dispensed >= i.ordered);
  return complete ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
}
