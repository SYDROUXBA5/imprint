import { describe, expect, it } from 'vitest';
import type { Correction, Session } from '../../src/domain/types';
import { imprintedDate } from '../../src/export/imprintedDate';

const manual = (id: string, date: string, seconds: number): Session => ({
  id, unit_id: 'u1', dog_id: 'd1', odour_id: 'mdma', handler_id: 'mA', kind: 'manual', session_date: date,
  started_at: null, ended_at: null, duration_s: seconds, client_clock_offset_s: null, server_received_at: null,
});
const timed = (id: string, date: string, startedAt: string, seconds: number | null): Session => ({
  ...manual(id, date, seconds ?? 0), kind: 'timed', started_at: startedAt, duration_s: seconds,
  ended_at: seconds === null ? null : startedAt,
});
const fix = (sessionId: string, create: string, extra: Partial<Correction>): Correction => ({
  id: `c-${sessionId}-${create}`, session_id: sessionId, unit_id: 'u1', trainer_id: 'mT', void: false,
  new_duration_s: null, reason: 'r', created_at: create, ...extra,
});

describe('imprintedDate', () => {
  it('is null while the total is under 4500 s', () => {
    expect(imprintedDate([manual('a', '2026-10-01', 3000), manual('b', '2026-10-02', 1499)], [])).toBeNull();
    expect(imprintedDate([], [])).toBeNull();
  });

  it('is the date of the session whose time takes the running total to 4500 s', () => {
    const sessions = [manual('a', '2026-10-01', 3000), manual('b', '2026-10-03', 1500), manual('c', '2026-10-04', 600)];
    expect(imprintedDate(sessions, [])).toBe('2026-10-03'); // exactly 4500 counts
  });

  it('does not move when more time is added after the crossing', () => {
    const sessions = [manual('a', '2026-10-01', 4600), manual('b', '2026-10-09', 3000)];
    expect(imprintedDate(sessions, [])).toBe('2026-10-01');
  });

  it('adds up in date order, whatever order the rows come in', () => {
    const sessions = [manual('late', '2026-10-09', 3000), manual('early', '2026-10-01', 1600)];
    // 1600 on the 1st, +3000 on the 9th = 4600: reached on the 9th
    expect(imprintedDate(sessions, [])).toBe('2026-10-09');
    expect(imprintedDate([...sessions].reverse(), [])).toBe('2026-10-09');
  });

  it('orders sessions on the same day by start time, with manual ones first', () => {
    const sessions = [
      timed('t2', '2026-10-05', '2026-10-05T16:00:00.000Z', 2000),
      manual('m1', '2026-10-05', 2000),
      timed('t1', '2026-10-05', '2026-10-05T09:00:00.000Z', 600),
    ];
    // Reached 4500 at t2 on the same date either way: the date is what is reported.
    expect(imprintedDate(sessions, [])).toBe('2026-10-05');
    const split = [
      timed('t1', '2026-10-05', '2026-10-05T09:00:00.000Z', 4000),
      timed('t2', '2026-10-06', '2026-10-06T09:00:00.000Z', 600),
    ];
    expect(imprintedDate(split, [])).toBe('2026-10-06');
  });

  it('uses durations after corrections, and a void adds nothing', () => {
    const sessions = [manual('a', '2026-10-01', 3000), manual('b', '2026-10-02', 3000)];
    expect(imprintedDate(sessions, [fix('a', '2026-10-03T00:00:00Z', { new_duration_s: 1200 })])).toBeNull(); // 1200 + 3000
    expect(imprintedDate(sessions, [fix('a', '2026-10-03T00:00:00Z', { new_duration_s: 1500 })])).toBe('2026-10-02');
    expect(imprintedDate(sessions, [fix('a', '2026-10-03T00:00:00Z', { void: true })])).toBeNull();
  });

  it('is null again when a later correction takes the total back under 4500 s', () => {
    const sessions = [manual('a', '2026-10-01', 4600)];
    expect(imprintedDate(sessions, [fix('a', '2026-10-02T00:00:00Z', { new_duration_s: 4000 })])).toBeNull();
  });

  it('counts the latest of two corrections', () => {
    const sessions = [manual('a', '2026-10-01', 600), manual('b', '2026-10-02', 4000)];
    const corrections = [
      fix('a', '2026-10-03T00:00:00Z', { new_duration_s: 100 }),
      fix('a', '2026-10-04T00:00:00Z', { new_duration_s: 600 }),
    ];
    expect(imprintedDate(sessions, corrections)).toBe('2026-10-02'); // 600 + 4000
  });

  it('ignores a timer that is still running', () => {
    const sessions = [manual('a', '2026-10-01', 4400), timed('r', '2026-10-05', '2026-10-05T09:00:00.000Z', null)];
    expect(imprintedDate(sessions, [])).toBeNull();
  });
});
