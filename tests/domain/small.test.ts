import { describe, expect, it } from 'vitest';
import { crossedTarget } from '../../src/domain/celebration';
import {
  formatClock, formatDay, formatMinSec, formatMinutesOfTarget, formatTimeOfDay, formatTyped, formatTypedClock, localDate,
} from '../../src/domain/format';
import { MAX_DOTS, capacityDots, freePlacesText } from '../../src/ui/shared';

describe('crossedTarget', () => {
  it('fires only on the move from below 4500 to 4500 or more', () => {
    expect(crossedTarget(4499, 4500)).toBe(true);
    expect(crossedTarget(4000, 5000)).toBe(true);
    expect(crossedTarget(4500, 4501)).toBe(false);
    expect(crossedTarget(4000, 4499)).toBe(false);
    expect(crossedTarget(5000, 4000)).toBe(false);
  });
});

describe('format', () => {
  it('formats a clock as m:ss under an hour and h:mm:ss above', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(724)).toBe('12:04');
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('formats progress as whole minutes of 75', () => {
    expect(formatMinutesOfTarget(2520)).toBe('42/75');
    expect(formatMinutesOfTarget(4499)).toBe('74/75');
  });

  it('formats totals as minutes:seconds, never switching to hours', () => {
    expect(formatMinSec(0)).toBe('0:00');
    expect(formatMinSec(724)).toBe('12:04');
    expect(formatMinSec(4500)).toBe('75:00');
    expect(formatMinSec(6065)).toBe('101:05');
  });

  it('formats a calendar date as "3 Oct" or "3 Oct 2026"', () => {
    expect(formatDay('2026-10-03', false)).toBe('3 Oct');
    expect(formatDay('2026-10-03')).toBe('3 Oct 2026');
    expect(formatDay('2026-01-31')).toBe('31 Jan 2026');
    expect(formatDay('2026-12-09', false)).toBe('9 Dec');
  });

  it('gives the local calendar date', () => {
    expect(localDate(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
  });
});

describe('typed times', () => {
  it('pads the minutes and never switches to hours for a total', () => {
    expect(formatTyped(0)).toBe('00:00');
    expect(formatTyped(362)).toBe('06:02');
    expect(formatTyped(2465)).toBe('41:05');
    expect(formatTyped(4500)).toBe('75:00');
    expect(formatTyped(6252)).toBe('104:12'); // three-digit minutes
    expect(formatTyped(-5)).toBe('00:00');
  });

  it('is fixed-width for an elapsed clock, and switches to hours from an hour on, as formatClock does', () => {
    expect(formatTypedClock(461)).toBe('07:41');
    expect(formatTypedClock(3599)).toBe('59:59');
    expect(formatTypedClock(3723)).toBe('1:02:03');
    expect(formatTypedClock(9000)).toBe('2:30:00');
  });

  it('shows the clock time of a timestamp as 24-hour HH:MM on this phone', () => {
    expect(formatTimeOfDay(new Date(2026, 9, 11, 14, 32, 9).toISOString())).toBe('14:32');
    expect(formatTimeOfDay(new Date(2026, 9, 11, 7, 5).toISOString())).toBe('07:05');
  });
});

describe('team capacity dots', () => {
  it('is a filled dot per dog and an outlined dot per planned place still free', () => {
    expect(capacityDots(3, 6)).toEqual({ filled: 3, empty: 3 });
    expect(capacityDots(0, 4)).toEqual({ filled: 0, empty: 4 });
    expect(capacityDots(2, 2)).toEqual({ filled: 2, empty: 0 });
  });

  it('keeps a filled dot for every dog even when the team is over its plan', () => {
    expect(capacityDots(5, 4)).toEqual({ filled: 5, empty: 0 });
  });

  it('shows dots for a plan of up to 12 dogs and none for a bigger plan or no plan', () => {
    expect(MAX_DOTS).toBe(12);
    expect(capacityDots(1, 12)).toEqual({ filled: 1, empty: 11 });
    expect(capacityDots(1, 13)).toBeNull();
    expect(capacityDots(1, null)).toBeNull();
    expect(capacityDots(1, undefined)).toBeNull();
  });

  it('says how many places a team has left, in words for small numbers', () => {
    expect(freePlacesText(3, 6)).toBe('Three more places in this team.');
    expect(freePlacesText(5, 6)).toBe('One more place in this team.');
    expect(freePlacesText(0, 14)).toBe('14 more places in this team.');
    expect(freePlacesText(6, 6)).toBe('');
    expect(freePlacesText(7, 6)).toBe('');
    expect(freePlacesText(2, null)).toBe('');
  });
});
