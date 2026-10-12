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

  it('interval_hours works with non-integer hours (floors)', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext({ ...base, frequencyType: 'interval_hours', intervalHours: 2.9 }, from)!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T12:00:00.000');
  });

  it('interval_hours with large interval skips multiple days', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext({ ...base, frequencyType: 'interval_hours', intervalHours: 72 }, from)!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-13T10:00:00.000');
  });

  it('daily with multiple times picks correct next slot across midnight', () => {
    const from = zoned('2026-06-10T23:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['02:00', '22:00'], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-11T02:00:00.000');
  });

  it('daily with multiple times on same day when from is early', () => {
    const from = zoned('2026-06-10T00:30:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['02:00', '22:00'], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T02:00:00.000');
  });

  it('weekdays with multiple times per day', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC'); // Wednesday
    const next = computeNext(
      { ...base, frequencyType: 'weekdays', times: ['08:00', '17:00'], weekdays: [1, 2, 3, 4, 5], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T17:00:00.000');
  });

  it('weekdays with Sunday (0) and Saturday (6) uses ISO weekday numbers', () => {
    // Luxon: 1=Mon ... 7=Sun. Our code uses: weekday % 7, so Sun=7->0, Mon=1->1, ..., Sat=6->6
    const from = zoned('2026-06-13T10:00:00', 'UTC'); // Saturday at 10:00
    const next = computeNext(
      { ...base, frequencyType: 'weekdays', times: ['10:00'], weekdays: [0, 6], timezone: 'UTC' },
      from,
    )!;
    // from is exactly at 10:00 on Saturday, so strictly after means next day (Sunday)
    expect(isoOf(next, 'UTC')).toBe('2026-06-14T10:00:00.000');
  });

  it('weekdays wraps to next week correctly', () => {
    const from = zoned('2026-06-13T11:00:00', 'UTC'); // Saturday past 10:00
    const next = computeNext(
      { ...base, frequencyType: 'weekdays', times: ['10:00'], weekdays: [0, 6], timezone: 'UTC' },
      from,
    )!;
    // Should wrap to Sunday
    expect(isoOf(next, 'UTC')).toBe('2026-06-14T10:00:00.000');
  });

  it('spring-forward DST with interval_hours adds exact hours in UTC', () => {
    // interval_hours is always in UTC, not affected by DST
    const from = zoned('2026-03-07T12:00:00', 'America/New_York');
    const next = computeNext({ ...base, frequencyType: 'interval_hours', intervalHours: 24 }, from)!;
    // 24 hours later in UTC = same local time next day (but DST shifted)
    expect(isoOf(next, 'America/New_York')).toBe('2026-03-08T13:00:00.000');
  });

  it('fall-back DST with interval_hours adds exact hours in UTC', () => {
    const from = zoned('2026-10-31T12:00:00', 'America/New_York');
    const next = computeNext({ ...base, frequencyType: 'interval_hours', intervalHours: 24 }, from)!;
    expect(isoOf(next, 'America/New_York')).toBe('2026-11-01T11:00:00.000');
  });

  it('returns null for invalid timezone (falls back to UTC+1h)', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['09:00'], timezone: 'Invalid/Timezone' },
      from,
    )!;
    // Falls back to UTC + 1 hour
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T11:00:00.000');
  });

  it('daily with time exactly at midnight', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['00:00'], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-11T00:00:00.000');
  });

  it('daily with time 23:59', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const next = computeNext(
      { ...base, frequencyType: 'daily', times: ['23:59'], timezone: 'UTC' },
      from,
    )!;
    expect(isoOf(next, 'UTC')).toBe('2026-06-10T23:59:00.000');
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

  it('interval_hours produces correct sequence', () => {
    const from = zoned('2026-06-10T10:00:00', 'UTC');
    const runs = previewNextRuns(
      { ...base, frequencyType: 'interval_hours', intervalHours: 6, timezone: 'UTC' },
      from,
      5,
    );
    expect(runs).toHaveLength(5);
    expect(isoOf(runs[0]!, 'UTC')).toBe('2026-06-10T16:00:00.000');
    expect(isoOf(runs[1]!, 'UTC')).toBe('2026-06-10T22:00:00.000');
    expect(isoOf(runs[2]!, 'UTC')).toBe('2026-06-11T04:00:00.000');
    expect(isoOf(runs[3]!, 'UTC')).toBe('2026-06-11T10:00:00.000');
    expect(isoOf(runs[4]!, 'UTC')).toBe('2026-06-11T16:00:00.000');
  });

  it('weekdays preview skips weekends', () => {
    const from = zoned('2026-06-12T10:00:00', 'UTC'); // Friday
    const runs = previewNextRuns(
      { ...base, frequencyType: 'weekdays', times: ['09:00'], weekdays: [1, 2, 3, 4, 5], timezone: 'UTC' },
      from,
      5,
    );
    expect(runs).toHaveLength(5);
    // Fri, Mon, Tue, Wed, Thu
    expect(isoOf(runs[0]!, 'UTC')).toBe('2026-06-15T09:00:00.000'); // Mon
    expect(isoOf(runs[1]!, 'UTC')).toBe('2026-06-16T09:00:00.000'); // Tue
    expect(isoOf(runs[2]!, 'UTC')).toBe('2026-06-17T09:00:00.000'); // Wed
    expect(isoOf(runs[3]!, 'UTC')).toBe('2026-06-18T09:00:00.000'); // Thu
    expect(isoOf(runs[4]!, 'UTC')).toBe('2026-06-19T09:00:00.000'); // Fri
  });
});

