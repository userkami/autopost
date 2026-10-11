import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { computeNext, previewNextRuns, type ScheduleConfig } from '@/lib/schedule';

function zoned(iso: string, zone: string): Date {
  return DateTime.fromISO(iso, { zone }).toJSDate();
}
function isoOf(date: Date, zone: string): string {
  return DateTime.fromJSDate(date).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS");
}

const base: Omit<ScheduleConfig, 'frequencyType'> = {
  intervalHours: 24,
  times: ['09:00'],
  weekdays: [1, 2, 3, 4, 5],
  timezone: 'UTC',
};

describe('computeNext (PLAN.md §12 — DST-safe scheduler math)', () => {
  it('interval_hours adds whole hours of elapsed time', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext({ ...base, frequencyType: 'interval_hours', intervalHours: 6 }, from)!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T16:00:00.000');
  });

  it('interval_hours clamps to a minimum of 1 hour', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext({ ...base, frequencyType: 'interval_hours', intervalHours: 0 }, from)!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T11:00:00.000');
  });

  it('daily returns the same clock time the next day in the schedule zone', () => {
    const from = zoned('2026-06-10T10:00:00', 'America/New_York');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['09:00'], timezone: 'America/New_York' },
      from,
    )!;
    expect(isoOf(next, 'America/New_York')).toBe('2026-06-11T09:00:00.000');
  });

  it('daily returns later today when the slot has not passed yet', () => {
    const from = zoned('2026-06-10T07:00:00', 'America/New_York');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['09:00'], timezone: 'America/New_York' },
      from,
    )!;
    expect(isoOf(next, 'America/New_York')).toBe('2026-06-10T09:00:00.000');
  });

  it('daily picks the earliest of multiple times still ahead of `from`', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['14:00', '09:00'], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T14:00:00.000');
  });

  it('daily is strictly after `from` when `from` lands exactly on a slot', () => {
    const from = zoned('2026-06-10T09:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['09:00'], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-11T09:00:00.000');
  });

  it('weekdays skips weekend days', () => {
    const from = zoned('2026-06-12T10:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'weekdays', times: ['08:00'], weekdays: [1, 2, 3, 4, 5], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-15T08:00:00.000');
  });

  it('weekdays honours a single-day set', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'weekdays', times: ['12:00'], weekdays: [0], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-14T12:00:00.000');
  });

  it('daily is DST-safe across spring-forward (nonexistent local time)', () => {
    // US 2026 spring forward: 2026-03-08 02:00 → 03:00 in New York.
    // 02:30 does not exist that day; luxon normalizes it to 03:30 EDT.
    const from = zoned('2026-03-07T12:00:00', 'America/New_York');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['02:30'], timezone: 'America/New_York' },
      from,
    )!;
    expect(isoOf(next, 'America/New_York')).toBe('2026-03-08T03:30:00.000');
  });

  it('daily is DST-safe across fall-back (ambiguous local time resolves forward)', () => {
    // US 2026 fall back: 2026-11-01 02:00 → 01:00 in New York; 01:30 happens twice.
    const from = zoned('2026-10-31T12:00:00', 'America/New_York');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['01:30'], timezone: 'America/New_York' },
      from,
    )!;
    expect(isoOf(next, 'America/New_York')).toBe('2026-11-01T01:30:00.000');
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('returns null for daily with no valid times', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    expect(computeNext({ ...base, frequencyType: 'daily', times: [], timezone: 'UTC' }, from)).toBeNull();
  });

  it('returns null for weekdays with no days selected', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    expect(
      computeNext({ ...base, frequencyType: 'weekdays', times: ['09:00'], weekdays: [], timezone: 'UTC' }, from),
    ).toBeNull();
  });

  it('ignores malformed time strings', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['banana', '25:00', '18:45'], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T18:45:00.000');
  });
});

describe('previewNextRuns (PLAN.md §13 — "next 5 run times")', () => {
  it('produces monotonically increasing slots', () => {
    const from = zoned('2026-06-10T07:00:00', 'UTC');
    const runs = previewNextRuns(
      { ...base, frequencyType: 'daily', times: ['09:00'], timezone: 'UTC' },
      from,
      5,
    );
    expect(runs).toHaveLength(5);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]!.getTime()).toBeGreaterThan(runs[i - 1]!.getTime());
    }
    expect(isoOf(runs[0]!, 'UTC')).toBe('2026-06-10T09:00:00.000');
  });

  it('stops early when the config cannot produce more slots', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const runs = previewNextRuns({ ...base, frequencyType: 'daily', times: [], timezone: 'UTC' }, from, 5);
    expect(runs).toHaveLength(0);
  });
});

