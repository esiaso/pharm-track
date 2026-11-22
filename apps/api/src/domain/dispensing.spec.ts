import { allocateFefo, canTransition, statusAfterDispense } from './dispensing';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('allocateFefo', () => {
  const batches = [
    { batchNumber: 'B3', expiryDate: d('2027-06-01'), quantityAvailable: 100 },
    { batchNumber: 'B1', expiryDate: d('2026-12-01'), quantityAvailable: 10 },
    { batchNumber: 'B0', expiryDate: d('2026-11-01'), quantityAvailable: 50 }, // expired
    { batchNumber: 'B2', expiryDate: d('2027-01-15'), quantityAvailable: 0 },
  ];

  it('takes earliest-expiring usable batches first', () => {
    const r = allocateFefo(batches, 30, { today: d('2026-11-22') });
    expect(r.allocations).toEqual([
      { batchNumber: 'B1', expiryDate: d('2026-12-01'), quantity: 10 },
      { batchNumber: 'B3', expiryDate: d('2027-06-01'), quantity: 20 },
    ]);
    expect(r.shortfall).toBe(0);
  });

  it('respects a minimum days-to-expiry margin', () => {
    const r = allocateFefo(batches, 5, { today: d('2026-11-22'), minDaysToExpiry: 30 });
    expect(r.allocations[0]!.batchNumber).toBe('B3');
  });

  it('reports shortfall', () => {
    const r = allocateFefo(batches, 200, { today: d('2026-11-22') });
    expect(r.allocated).toBe(110);
    expect(r.shortfall).toBe(90);
  });
});

describe('dispense state machine', () => {
  it('allows the main path and blocks illegal moves', () => {
    expect(canTransition('PENDING', 'IN_VERIFICATION')).toBe(true);
    expect(canTransition('VERIFIED', 'DISPENSED')).toBe(true);
    expect(canTransition('PENDING', 'DISPENSED')).toBe(false);
    expect(canTransition('CANCELLED', 'PENDING')).toBe(false);
  });

  it('derives partial vs complete status', () => {
    expect(statusAfterDispense([{ ordered: 10, dispensed: 10 }])).toBe('DISPENSED');
    expect(statusAfterDispense([{ ordered: 10, dispensed: 4 }])).toBe('PARTIALLY_DISPENSED');
  });
});
