import { describe, expect, it } from 'vitest';
import type { Correction, Session } from '../../src/domain/types';
import {
  IMPRINT_TARGET_S, currentDuration, isImprinted, isRunning,
  latestCorrection, liveElapsed, odourTotal,
} from '../../src/domain/totals';

const session = (o: Partial<Session> = {}): Session => ({
  id: 's1', unit_id: 'u1', dog_id: 'd1', odour_id: 'mdma', handler_id: 'm1',
  kind: 'timed', session_date: '2026-10-03',
  started_at: '2026-10-03T10:00:00.000Z', ended_at: '2026-10-03T10:10:00.000Z',
  duration_s: 600, client_clock_offset_s: null, server_received_at: null, ...o,
});

const correction = (o: Partial<Correction> = {}): Correction => ({
  id: 'c1', session_id: 's1', unit_id: 'u1', trainer_id: 't1', void: false,
  new_duration_s: 300, reason: 'fix', created_at: '2026-10-03T12:00:00.000Z', ...o,
});

const at = (iso: string) => Date.parse(iso);

describe('totals', () => {
  it('target is 75 minutes', () => {
    expect(IMPRINT_TARGET_S).toBe(4500);
  });

  it('uses the session duration when there is no correction', () => {
    expect(currentDuration(session(), [])).toBe(600);
  });

  it('uses the latest correction by created_at', () => {
    const cs = [
      correction({ id: 'c1', new_duration_s: 300, created_at: '2026-10-03T12:00:00.000Z' }),
      correction({ id: 'c2', new_duration_s: 120, created_at: '2026-10-03T13:00:00.000Z' }),
    ];
    expect(latestCorrection('s1', cs)?.id).toBe('c2');
    expect(currentDuration(session(), cs)).toBe(120);
  });

  it('ignores corrections for other sessions', () => {
    expect(currentDuration(session(), [correction({ session_id: 'other' })])).toBe(600);
  });

  it('counts a voided session as 0', () => {
    expect(currentDuration(session(), [correction({ void: true, new_duration_s: null })])).toBe(0);
  });

  it('a running session stores 0 and has live elapsed time', () => {
    const s = session({ ended_at: null, duration_s: null });
    expect(isRunning(s, [])).toBe(true);
    expect(currentDuration(s, [])).toBe(0);
    expect(liveElapsed(s, [], at('2026-10-03T10:02:05.900Z'))).toBe(125);
  });

  it('a corrected running session is no longer running', () => {
    const s = session({ ended_at: null, duration_s: null });
    const cs = [correction({ new_duration_s: 480 })];
    expect(isRunning(s, cs)).toBe(false);
    expect(liveElapsed(s, cs, at('2026-10-03T13:00:00.000Z'))).toBe(0);
    expect(currentDuration(s, cs)).toBe(480);
  });

  it('manual sessions are never running', () => {
    const s = session({ kind: 'manual', started_at: null, ended_at: null, duration_s: 900 });
    expect(isRunning(s, [])).toBe(false);
    expect(currentDuration(s, [])).toBe(900);
  });

  it('sums only the same dog and odour', () => {
    const sessions = [
      session({ id: 'a', duration_s: 600 }),
      session({ id: 'b', duration_s: 300 }),
      session({ id: 'c', odour_id: 'cocaine', duration_s: 999 }),
      session({ id: 'd', dog_id: 'd2', duration_s: 999 }),
    ];
    expect(odourTotal(sessions, [], 'd1', 'mdma')).toBe(900);
  });

  it('adds live elapsed time only when now is given', () => {
    const sessions = [
      session({ id: 'a', duration_s: 600 }),
      session({ id: 'r', ended_at: null, duration_s: null, started_at: '2026-10-03T11:00:00.000Z' }),
    ];
    expect(odourTotal(sessions, [], 'd1', 'mdma')).toBe(600);
    expect(odourTotal(sessions, [], 'd1', 'mdma', at('2026-10-03T11:01:00.000Z'))).toBe(660);
  });

  it('imprinted at exactly 75:00, not at 74:59', () => {
    expect(isImprinted(4499)).toBe(false);
    expect(isImprinted(4500)).toBe(true);
  });
});
