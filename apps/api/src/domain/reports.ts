/**
 * Pure calculations for phase 5 reporting: WHO DDD counts, stock-out days,
 * WHO/INRUD prescribing indicators and reporting periods.
 */
import { atcMatches, isAntimicrobial } from './codes';

// ── Periods ─────────────────────────────────────────────────────────────────

/** Facilities report in East Africa Time (UTC+3, no daylight saving). */
const EAT_OFFSET_MS = 3 * 3_600_000;

/** "2026-11" → [2026-10-31T21:00Z, 2026-11-30T21:00Z): the calendar month in Nairobi time. */
export function monthPeriod(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`Month must look like 2026-11, got "${month}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1) - EAT_OFFSET_MS), to: new Date(Date.UTC(y, mo + 1, 1) - EAT_OFFSET_MS) };
}

// ── Defined Daily Doses ─────────────────────────────────────────────────────

const MASS: Record<string, number> = { g: 1, mg: 1e-3, mcg: 1e-6, µg: 1e-6, ug: 1e-6 };
const UNITS: Record<string, number> = { u: 1, iu: 1, tu: 1e3, mu: 1e6 };

function factor(unit: string): { dim: string; f: number } | null {
  const u = unit.trim().toLowerCase();
  if (u in MASS) return { dim: 'mass', f: MASS[u]! };
  if (u in UNITS) return { dim: 'units', f: UNITS[u]! };
  if (u === 'mmol') return { dim: 'mmol', f: 1 };
  if (u === 'ml') return { dim: 'ml', f: 1 };
  return null;
}

/**
 * Number of WHO Defined Daily Doses in `quantity` units of issue, each holding
 * `strengthValue strengthUnit` of the substance. Null when it cannot be
 * computed (no DDD, no strength, or units that do not convert), so reports
 * show a gap rather than a wrong number. Only valid for single-substance
 * products whose strength is per unit of issue (tablet, capsule, vial).
 */
export function dddCount(quantity: number, strengthValue: number | null | undefined, strengthUnit: string | null | undefined, ddd: number | null | undefined, dddUnit: string | null | undefined): number | null {
  if (!strengthValue || !strengthUnit || !ddd || !dddUnit) return null;
  const s = factor(strengthUnit);
  const d = factor(dddUnit);
  if (!s || !d || s.dim !== d.dim) return null;
  return round((quantity * strengthValue * s.f) / (ddd * d.f), 2);
}

// ── Stock-outs ──────────────────────────────────────────────────────────────

export interface Episode {
  startedAt: Date;
  endedAt: Date | null;
}

/** Days out of stock within [from, to), counting an open episode up to `now` (or `to`). */
export function stockOutDays(episodes: Episode[], from: Date, to: Date, now = new Date()): number {
  const end = Math.min(to.getTime(), now.getTime());
  let ms = 0;
  for (const e of episodes) {
    const s = Math.max(e.startedAt.getTime(), from.getTime());
    const f = Math.min((e.endedAt ?? new Date(end)).getTime(), end);
    if (f > s) ms += f - s;
  }
  return round(ms / 86_400_000, 1);
}

export function wasOutAt(episodes: Episode[], at: Date): boolean {
  return episodes.some((e) => e.startedAt <= at && (e.endedAt === null || e.endedAt > at));
}

// ── Prescribing indicators (WHO/INRUD) ──────────────────────────────────────

export interface EncounterItem {
  atcCode: string;
  route: string;
  /** On the facility formulary (stands in for the essential medicines list). */
  onFormulary: boolean;
}
export interface Encounter {
  prescriberId: string;
  items: EncounterItem[];
  overrides: number;
}

export interface Indicators {
  encounters: number;
  items: number;
  /** WHO core indicator 1: average number of medicines per encounter. */
  avgMedicinesPerEncounter: number;
  /** WHO core indicator 3: % encounters with an antibiotic (ATC J01). */
  pctEncountersWithAntibiotic: number;
  /** WHO core indicator 4: % encounters with an injection. */
  pctEncountersWithInjection: number;
  /** WHO core indicator 5 (adapted): % of medicines on the facility formulary. */
  pctItemsOnFormulary: number;
  /** % encounters with any antimicrobial (J01, J02, J04, J05, P01), for stewardship. */
  pctEncountersWithAntimicrobial: number;
  /** Safety warnings overridden per 100 items. */
  overridesPer100Items: number;
}

const INJECTION_ROUTES = new Set(['IV', 'IM', 'SC', 'SUBCUT', 'SUBCUTANEOUS', 'INTRAVENOUS', 'INTRAMUSCULAR', 'INJECTION', 'ID', 'INTRADERMAL']);
export const isInjection = (route: string) => INJECTION_ROUTES.has(route.trim().toUpperCase());

export function prescribingIndicators(encounters: Encounter[]): Indicators {
  const n = encounters.length;
  const items = encounters.flatMap((e) => e.items);
  const pct = (count: number, of: number) => (of ? round((100 * count) / of, 1) : 0);
  return {
    encounters: n,
    items: items.length,
    avgMedicinesPerEncounter: n ? round(items.length / n, 2) : 0,
    pctEncountersWithAntibiotic: pct(encounters.filter((e) => e.items.some((i) => atcMatches('J01', i.atcCode))).length, n),
    pctEncountersWithInjection: pct(encounters.filter((e) => e.items.some((i) => isInjection(i.route))).length, n),
    pctItemsOnFormulary: pct(items.filter((i) => i.onFormulary).length, items.length),
    pctEncountersWithAntimicrobial: pct(encounters.filter((e) => e.items.some((i) => isAntimicrobial(i.atcCode))).length, n),
    overridesPer100Items: pct(encounters.reduce((s, e) => s + e.overrides, 0), items.length),
  };
}

export function indicatorsByPrescriber(encounters: Encounter[]): ({ prescriberId: string } & Indicators)[] {
  const by = new Map<string, Encounter[]>();
  for (const e of encounters) by.set(e.prescriberId, [...(by.get(e.prescriberId) ?? []), e]);
  return [...by.entries()].map(([prescriberId, list]) => ({ prescriberId, ...prescribingIndicators(list) })).sort((a, b) => b.encounters - a.encounters || a.prescriberId.localeCompare(b.prescriberId));
}

// ── ADR reporting targets ───────────────────────────────────────────────────

/**
 * Days after a report is recorded by which it should reach PPB. These are
 * internal targets, configurable with ADR_SERIOUS_DAYS / ADR_NON_SERIOUS_DAYS:
 * confirm them against current PPB pharmacovigilance guidance.
 */
export function adrDueBy(reportedAt: Date, seriousness: string, days = { serious: 7, nonSerious: 30 }): Date {
  const d = seriousness === 'NON_SERIOUS' ? days.nonSerious : days.serious;
  return new Date(reportedAt.getTime() + d * 86_400_000);
}

export function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
