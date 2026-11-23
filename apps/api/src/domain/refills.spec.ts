import { adherenceSummary, daysOfSupply, isEarlyRefill, proportionOfDaysCovered, refillStatus, reminderToSend, scheduleAfterFill } from './refills';
import { DEFAULT_TEMPLATES, normaliseKenyanMobile, PRIVATE_TEMPLATES, renderTemplate, tidySms, unknownPlaceholders } from './sms';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('refill schedule', () => {
  const base = { refillsAuthorised: 2, refillsUsed: 0, expiresAt: d('2027-05-22'), graceDays: 3 };

  it('computes days of supply', () => {
    expect(daysOfSupply({ quantity: 60, unitsPerDose: 1, frequencyPerDay: 2, durationDays: 0 })).toBe(30);
    expect(daysOfSupply({ quantity: 1, frequencyPerDay: 2, durationDays: 14 })).toBe(14);
  });

  it('sets the next due date and window after the initial fill', () => {
    const s = scheduleAfterFill(base, { dispensedAt: d('2026-11-22'), daysOfSupply: 30, isRefill: false });
    expect(s.nextDueDate).toEqual(d('2026-12-22'));
    expect(s.earliestRefillDate).toEqual(d('2026-12-19'));
    expect(s.refillsUsed).toBe(0);
    expect(s.status).toBe('UPCOMING');
  });

  it('moves through UPCOMING, DUE and OVERDUE', () => {
    const s = scheduleAfterFill(base, { dispensedAt: d('2026-11-22'), daysOfSupply: 30, isRefill: false });
    expect(refillStatus(s, d('2026-12-10'))).toBe('UPCOMING');
    expect(refillStatus(s, d('2026-12-19'))).toBe('DUE');
    expect(refillStatus(s, d('2026-12-25'))).toBe('DUE');
    expect(refillStatus(s, d('2026-12-26'))).toBe('OVERDUE');
    expect(isEarlyRefill(s, d('2026-12-15'))).toBe(true);
    expect(isEarlyRefill(s, d('2026-12-19'))).toBe(false);
  });

  it('completes when all refills are used and expires after validity', () => {
    const s = scheduleAfterFill({ ...base, refillsUsed: 1 }, { dispensedAt: d('2027-01-20'), daysOfSupply: 30, isRefill: true });
    expect(s.refillsUsed).toBe(2);
    expect(s.status).toBe('COMPLETED');
    const t = scheduleAfterFill(base, { dispensedAt: d('2027-05-01'), daysOfSupply: 30, isRefill: false });
    expect(refillStatus(t, d('2027-06-10'))).toBe('EXPIRED');
  });

  it('picks the right reminder for the day', () => {
    const s = scheduleAfterFill(base, { dispensedAt: d('2026-11-22'), daysOfSupply: 30, isRefill: false });
    expect(reminderToSend(s, d('2026-12-19'))).toBe('REFILL_REMINDER');
    expect(reminderToSend(s, d('2026-12-20'))).toBeNull();
    expect(reminderToSend(s, d('2026-12-22'))).toBe('REFILL_DUE');
    expect(reminderToSend(s, d('2026-12-27'))).toBe('REFILL_OVERDUE');
  });

  it('computes proportion of days covered with carry-over', () => {
    const pdc = proportionOfDaysCovered(
      [
        { dispensedAt: d('2026-01-01'), daysOfSupply: 30 },
        { dispensedAt: d('2026-01-28'), daysOfSupply: 30 }, // early: coverage carries over to Jan 31
      ],
      d('2026-01-01'),
      d('2026-03-01'),
    );
    expect(pdc).toBeCloseTo(60 / 60, 5);
  });

  it('summarises adherence: late refills, average lateness and days covered', () => {
    // 30-day supplies collected Jan 1, Feb 10 (10 days late) and Mar 12 (on time).
    const a = adherenceSummary({ fillDates: [d('2026-02-10'), d('2026-01-01'), d('2026-03-12')], daysOfSupply: 30, graceDays: 3, periodStart: d('2026-01-01'), periodEnd: d('2026-04-10') });
    expect(a).toMatchObject({ fills: 3, lateRefills: 1, averageDaysLate: 5, observedDays: 100 });
    expect(a.pdc).toBeCloseTo(0.9, 3);
  });

  it('does not count days after the course ended, and starts at the first fill', () => {
    const a = adherenceSummary({ fillDates: [d('2026-03-01')], daysOfSupply: 30, graceDays: 3, periodStart: d('2026-01-01'), periodEnd: d('2026-06-30'), therapyEnd: d('2026-03-30') });
    expect(a).toMatchObject({ fills: 1, lateRefills: 0, pdc: 1, observedDays: 30 });
    expect(adherenceSummary({ fillDates: [], daysOfSupply: 30, graceDays: 3, periodStart: d('2026-01-01'), periodEnd: d('2026-02-01') }).pdc).toBeNull();
  });
});

describe('sms helpers', () => {
  it('renders templates', () => {
    expect(renderTemplate('Hi {{ name }}, {{x}}', { name: 'Amina' })).toBe('Hi Amina, ');
  });
  it('drops a label left empty, such as a missing phone', () => {
    expect(tidySms('Please visit Riverside Clinic to collect it. Enquiries: .')).toBe('Please visit Riverside Clinic to collect it.');
    expect(tidySms('Tafadhali fika Riverside. Maswali: .')).toBe('Tafadhali fika Riverside.');
    expect(tidySms('Hello , come at 10:30. Enquiries: 0711 000 111.')).toBe('Hello, come at 10:30. Enquiries: 0711 000 111.');
  });
  it('finds placeholders that are not supported', () => {
    expect(unknownPlaceholders('Hi {{patientFirstName}}, {{ drugname }} at {{facilityName}} {{x}} {{x}}')).toEqual(['drugname', 'x']);
    expect(unknownPlaceholders(DEFAULT_TEMPLATES.REFILL_REMINDER.en)).toEqual([]);
  });
  it('has wording without the medicine name for every message and language', () => {
    for (const [purpose, langs] of Object.entries(DEFAULT_TEMPLATES)) {
      for (const lang of Object.keys(langs)) {
        const body = PRIVATE_TEMPLATES[purpose][lang];
        expect(body).toBeTruthy();
        expect(body).not.toMatch(/drugName/);
        expect(unknownPlaceholders(body)).toEqual([]);
      }
    }
  });
  it('normalises Kenyan mobiles', () => {
    expect(normaliseKenyanMobile('0712 345 678')).toBe('+254712345678');
    expect(normaliseKenyanMobile('+254 110 345678')).toBe('+254110345678');
    expect(normaliseKenyanMobile('254712345678')).toBe('+254712345678');
    expect(normaliseKenyanMobile('0612345678')).toBeNull();
  });
});
