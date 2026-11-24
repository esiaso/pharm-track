import { addDays, startOfDay } from './dispensing';

export type RefillStatus = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export interface RefillPolicy {
  /** A refill may be dispensed this many days before the supply runs out. Default 3. */
  earlyWindowDays: number;
  /** Days after the due date before a refill counts as overdue. Default 3. */
  graceDays: number;
  /** Reminder SMS this many days before the due date. Default 3. */
  reminderLeadDays: number;
}

export const DEFAULT_REFILL_POLICY: RefillPolicy = { earlyWindowDays: 3, graceDays: 3, reminderLeadDays: 3 };

/**
 * Days of supply in a fill: quantity / (dose units per administration x administrations per day).
 * `unitsPerDose` converts the prescribed dose into units of issue (e.g. 500 mg dose of a 500 mg
 * tablet = 1). Falls back to the prescribed duration if the maths is not possible.
 */
export function daysOfSupply(fill: { quantity: number; unitsPerDose?: number; frequencyPerDay: number; durationDays: number }): number {
  const perDay = (fill.unitsPerDose ?? 0) * fill.frequencyPerDay;
  if (perDay > 0) return Math.floor(fill.quantity / perDay);
  return fill.durationDays;
}

export interface RefillScheduleState {
  refillsAuthorised: number;
  refillsUsed: number;
  lastDispensedAt: Date | null;
  nextDueDate: Date | null;
  earliestRefillDate: Date | null;
  graceDays: number;
  expiresAt: Date;
  status: RefillStatus;
}

/** Recalculates the schedule after a fill (initial or refill) was dispensed. */
export function scheduleAfterFill(
  state: Pick<RefillScheduleState, 'refillsAuthorised' | 'refillsUsed' | 'expiresAt' | 'graceDays'>,
  fill: { dispensedAt: Date; daysOfSupply: number; isRefill: boolean },
  policy: RefillPolicy = DEFAULT_REFILL_POLICY,
): RefillScheduleState {
  const refillsUsed = state.refillsUsed + (fill.isRefill ? 1 : 0);
  const nextDueDate = addDays(startOfDay(fill.dispensedAt), fill.daysOfSupply);
  const next: RefillScheduleState = {
    refillsAuthorised: state.refillsAuthorised,
    refillsUsed,
    lastDispensedAt: fill.dispensedAt,
    nextDueDate,
    earliestRefillDate: addDays(nextDueDate, -policy.earlyWindowDays),
    graceDays: state.graceDays,
    expiresAt: state.expiresAt,
    status: 'UPCOMING',
  };
  next.status = refillStatus(next, fill.dispensedAt);
  return next;
}

/** Status of a schedule on a given day. Terminal states (COMPLETED, CANCELLED) are kept. */
export function refillStatus(s: RefillScheduleState, today: Date = new Date()): RefillStatus {
  if (s.status === 'CANCELLED') return 'CANCELLED';
  if (s.refillsUsed >= s.refillsAuthorised) return 'COMPLETED';
  const d = startOfDay(today);
  if (d > startOfDay(s.expiresAt)) return 'EXPIRED';
  if (!s.nextDueDate) return 'UPCOMING';
  const due = startOfDay(s.nextDueDate);
  if (d > addDays(due, s.graceDays)) return 'OVERDUE';
  if (s.earliestRefillDate && d >= startOfDay(s.earliestRefillDate)) return 'DUE';
  return 'UPCOMING';
}

export function isEarlyRefill(s: RefillScheduleState, on: Date = new Date()): boolean {
  return s.earliestRefillDate != null && startOfDay(on) < startOfDay(s.earliestRefillDate);
}

export type ReminderPurpose = 'REFILL_REMINDER' | 'REFILL_DUE' | 'REFILL_OVERDUE';

/**
 * Which reminder (if any) to send today. The caller dedupes with a key of
 * purpose + schedule + due date so each reminder goes out once per cycle.
 */
export function reminderToSend(
  s: RefillScheduleState,
  today: Date = new Date(),
  policy: RefillPolicy = DEFAULT_REFILL_POLICY,
): ReminderPurpose | null {
  const status = refillStatus(s, today);
  if (!s.nextDueDate || ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(status)) return null;
  const d = startOfDay(today).getTime();
  const due = startOfDay(s.nextDueDate);
  if (status === 'OVERDUE') return 'REFILL_OVERDUE';
  if (d === due.getTime()) return 'REFILL_DUE';
  if (d === addDays(due, -policy.reminderLeadDays).getTime()) return 'REFILL_REMINDER';
  return null;
}

/** Proportion of days covered across fills, for adherence reporting (0..1). */
export function proportionOfDaysCovered(
  fills: { dispensedAt: Date; daysOfSupply: number }[],
  periodStart: Date,
  periodEnd: Date,
): number {
  const start = startOfDay(periodStart).getTime();
  const end = startOfDay(periodEnd).getTime();
  const totalDays = Math.round((end - start) / 86_400_000) + 1;
  if (totalDays <= 0) return 0;
  // Fills make back-to-back segments (an early refill starts where the last
  // supply ends), so they never overlap: add up each segment's days in range.
  const DAY = 86_400_000;
  let covered = 0;
  let cursor = 0;
  for (const f of [...fills].sort((a, b) => a.dispensedAt.getTime() - b.dispensedAt.getTime())) {
    const from = Math.max(startOfDay(f.dispensedAt).getTime(), cursor);
    const to = from + f.daysOfSupply * DAY; // exclusive
    covered += Math.max(0, Math.round((Math.min(to, end + DAY) - Math.max(from, start)) / DAY));
    cursor = to;
  }
  return covered / totalDays;
}

/** PDC at or above this counts as adherent (the usual 80% threshold). */
export const ADHERENT_PDC = 0.8;

export interface AdherenceSummary {
  fills: number;
  /** Days between fills minus the days of supply, on average. Negative means early. */
  averageDaysLate: number;
  /** Refills collected more than `graceDays` after the supply ran out. */
  lateRefills: number;
  /** Proportion of days covered over the observed days, 0..1; null when no day is observed. */
  pdc: number | null;
  observedDays: number;
}

/**
 * Adherence for one refill item from its fill dates. Days are observed from
 * the later of the period start and the first fill, to the earlier of the
 * period end and `therapyEnd` (when the course has finished or expired), so a
 * finished course doesn't count as missed days. Fills before the period still
 * cover the start of it.
 */
export function adherenceSummary(p: {
  fillDates: Date[];
  daysOfSupply: number;
  graceDays: number;
  periodStart: Date;
  periodEnd: Date;
  therapyEnd?: Date | null;
}): AdherenceSummary {
  const dates = [...p.fillDates].sort((a, b) => a.getTime() - b.getTime());
  const gaps = dates.slice(1).map((d, i) => Math.round((startOfDay(d).getTime() - startOfDay(dates[i]!).getTime()) / 86_400_000) - p.daysOfSupply);
  const averageDaysLate = gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : 0;
  const lateRefills = gaps.filter((g) => g > p.graceDays).length;
  if (!dates.length) return { fills: 0, averageDaysLate, lateRefills, pdc: null, observedDays: 0 };
  const start = new Date(Math.max(startOfDay(p.periodStart).getTime(), startOfDay(dates[0]!).getTime()));
  const endCap = p.therapyEnd ? Math.min(startOfDay(p.periodEnd).getTime(), startOfDay(p.therapyEnd).getTime()) : startOfDay(p.periodEnd).getTime();
  const end = new Date(endCap);
  const observedDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (observedDays <= 0) return { fills: dates.length, averageDaysLate, lateRefills, pdc: null, observedDays: 0 };
  const pdc = proportionOfDaysCovered(dates.map((dispensedAt) => ({ dispensedAt, daysOfSupply: p.daysOfSupply })), start, end);
  return { fills: dates.length, averageDaysLate, lateRefills, pdc: Math.round(pdc * 1000) / 1000, observedDays };
}
