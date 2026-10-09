import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/domain/types';
import { CLOCK_CHECK_LIMIT_S, needsClockCheck, overlappingSessionIds } from '../../src/domain/flags';

const timed = (id: string, dog: string, start: string, end: string | null): Session => ({
  id, unit_id: 'u1', dog_id: dog, odour_id: 'mdma', handler_id: 'm1', kind: 'timed',
  session_date: '2026-10-03', started_at: start, ended_at: end,
  duration_s: end ? 60 : null, client_clock_offset_s: null, server_received_at: null,
});

describe('overlap', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');

  it('flags both sessions when time ranges overlap on the same dog', () => {
    const ids = overlappingSessionIds([
      timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z'),
      timed('b', 'd1', '2026-10-03T10:05:00Z', '2026-10-03T10:20:00Z'),
    ], now);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('does not flag touching ranges or different dogs', () => {
    const ids = overlappingSessionIds([
      timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z'),
      timed('b', 'd1', '2026-10-03T10:10:00Z', '2026-10-03T10:20:00Z'),
      timed('c', 'd2', '2026-10-03T10:05:00Z', '2026-10-03T10:08:00Z'),
    ], now);
    expect(ids.size).toBe(0);
  });

  it('treats a running session as lasting until now', () => {
    const ids = overlappingSessionIds([
      timed('a', 'd1', '2026-10-03T11:00:00Z', null),
      timed('b', 'd1', '2026-10-03T11:30:00Z', '2026-10-03T11:40:00Z'),
    ], now);
    expect(ids.size).toBe(2);
  });

  it('ignores manual sessions', () => {
    const manual: Session = { ...timed('m', 'd1', '2026-10-03T10:00:00Z', null), kind: 'manual', started_at: null, duration_s: 600 };
    const ids = overlappingSessionIds([manual, timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z')], now);
    expect(ids.size).toBe(0);
  });
});

describe('clock check', () => {
  it('flags offsets over 10 minutes either way', () => {
    expect(CLOCK_CHECK_LIMIT_S).toBe(600);
    const s = timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z');
    expect(needsClockCheck({ ...s, client_clock_offset_s: 600 })).toBe(false);
    expect(needsClockCheck({ ...s, client_clock_offset_s: 601 })).toBe(true);
    expect(needsClockCheck({ ...s, client_clock_offset_s: -601 })).toBe(true);
    expect(needsClockCheck({ ...s, client_clock_offset_s: null })).toBe(false);
  });
});
