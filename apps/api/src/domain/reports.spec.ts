import { adrDueBy, dddCount, indicatorsByPrescriber, isInjection, monthPeriod, prescribingIndicators, stockOutDays, wasOutAt } from './reports';

describe('monthPeriod', () => {
  it('is the calendar month in Nairobi time', () => {
    expect(monthPeriod('2026-11')).toEqual({ from: new Date('2026-10-31T21:00:00Z'), to: new Date('2026-11-30T21:00:00Z') });
    expect(monthPeriod('2026-12').to).toEqual(new Date('2026-12-31T21:00:00Z'));
    expect(() => monthPeriod('2026-13')).toThrow();
    expect(() => monthPeriod('Nov 2026')).toThrow();
  });
});

describe('dddCount', () => {
  it('converts strength units to the DDD unit', () => {
    expect(dddCount(60, 500, 'mg', 2, 'g')).toBe(15); // metformin 500 mg x 60, DDD 2 g
    expect(dddCount(21, 500, 'mg', 1.5, 'g')).toBe(7); // amoxicillin 500 mg x 21, DDD 1.5 g
    expect(dddCount(10, 100, 'mcg', 0.1, 'mg')).toBe(10);
    expect(dddCount(5, 1000, 'IU', 1, 'TU')).toBe(5);
  });
  it('returns null rather than a wrong number', () => {
    expect(dddCount(10, 500, 'mg', null, 'g')).toBeNull();
    expect(dddCount(10, null, 'mg', 2, 'g')).toBeNull();
    expect(dddCount(10, 500, 'mg', 2, 'U')).toBeNull();
    expect(dddCount(10, 5, 'mg/ml', 2, 'g')).toBeNull();
  });
});

describe('stockOutDays', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date('2026-11-11T00:00:00Z');
  it('clips episodes to the period and counts open ones up to now', () => {
    const eps = [
      { startedAt: new Date('2026-10-30T00:00:00Z'), endedAt: new Date('2026-11-02T12:00:00Z') }, // 1.5 days inside
      { startedAt: new Date('2026-11-09T00:00:00Z'), endedAt: null }, // open
    ];
    expect(stockOutDays(eps, from, to, new Date('2026-11-10T00:00:00Z'))).toBe(2.5);
    expect(stockOutDays(eps, from, to, new Date('2026-12-01T00:00:00Z'))).toBe(3.5);
    expect(stockOutDays([], from, to)).toBe(0);
  });
  it('knows whether an item was out at a given time', () => {
    const eps = [{ startedAt: new Date('2026-11-05T00:00:00Z'), endedAt: new Date('2026-11-06T00:00:00Z') }];
    expect(wasOutAt(eps, new Date('2026-11-05T10:00:00Z'))).toBe(true);
    expect(wasOutAt(eps, new Date('2026-11-06T00:00:00Z'))).toBe(false);
  });
});

describe('prescribing indicators', () => {
  const enc = (prescriberId: string, items: [string, string, boolean][], overrides = 0) => ({ prescriberId, overrides, items: items.map(([atcCode, route, onFormulary]) => ({ atcCode, route, onFormulary })) });
  const data = [
    enc('DR-1', [['J01CA04', 'ORAL', true], ['N02BE01', 'ORAL', true]]),
    enc('DR-1', [['A10BA02', 'ORAL', true]], 1),
    enc('DR-2', [['J02AC01', 'IV', false], ['N02BE01', 'ORAL', true], ['M01AE01', 'ORAL', true]]),
    enc('DR-2', [['C08CA01', 'ORAL', true]]),
  ];
  it('computes the WHO core indicators', () => {
    expect(prescribingIndicators(data)).toEqual({
      encounters: 4,
      items: 7,
      avgMedicinesPerEncounter: 1.75,
      pctEncountersWithAntibiotic: 25,
      pctEncountersWithInjection: 25,
      pctItemsOnFormulary: 85.7,
      pctEncountersWithAntimicrobial: 50,
      overridesPer100Items: 14.3,
    });
    expect(prescribingIndicators([]).avgMedicinesPerEncounter).toBe(0);
  });
  it('groups by prescriber', () => {
    expect(indicatorsByPrescriber(data).map((p) => [p.prescriberId, p.encounters, p.avgMedicinesPerEncounter])).toEqual([['DR-1', 2, 1.5], ['DR-2', 2, 2]]);
  });
  it('recognises injection routes', () => {
    expect(['iv', 'IM', 'SC', 'ORAL'].map(isInjection)).toEqual([true, true, true, false]);
  });
});

describe('adrDueBy', () => {
  it('uses the serious or non-serious target', () => {
    const at = new Date('2026-11-01T00:00:00Z');
    expect(adrDueBy(at, 'SERIOUS_DEATH')).toEqual(new Date('2026-11-08T00:00:00Z'));
    expect(adrDueBy(at, 'NON_SERIOUS', { serious: 2, nonSerious: 10 })).toEqual(new Date('2026-11-11T00:00:00Z'));
  });
});
