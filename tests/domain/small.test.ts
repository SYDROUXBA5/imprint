import { describe, expect, it } from 'vitest';
import { crossedTarget } from '../../src/domain/celebration';
import { formatClock, formatDay, formatMinSec, formatMinutesOfTarget, localDate } from '../../src/domain/format';
import { isValidInviteCode, normalizeInviteCode } from '../../src/domain/inviteCode';

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

describe('invite codes', () => {
  it('normalises case, spaces and dashes', () => {
    expect(normalizeInviteCode(' ab3-k9z ')).toBe('AB3K9Z');
  });

  it('accepts 6 chars from the alphabet and rejects 0, O, 1, I', () => {
    expect(isValidInviteCode('AB3K9Z')).toBe(true);
    expect(isValidInviteCode('AB3K9')).toBe(false);
    expect(isValidInviteCode('AB0K9Z')).toBe(false);
    expect(isValidInviteCode('ABOK9Z')).toBe(false);
    expect(isValidInviteCode('AB1K9Z')).toBe(false);
    expect(isValidInviteCode('ABIK9Z')).toBe(false);
  });
});
