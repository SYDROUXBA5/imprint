import { describe, expect, it } from 'vitest';
import { progressLine, trainedOdours } from '../../src/domain/progress';
import type { Correction, Session } from '../../src/domain/types';
import { ODOURS } from '../fixtures';

const base: Session = {
  id: '', unit_id: 'u1', dog_id: 'd1', odour_id: 'mdma', handler_id: 'mH', kind: 'manual',
  session_date: '2026-10-01', started_at: null, ended_at: null, duration_s: 0,
  client_clock_offset_s: null, server_received_at: null,
};
const manual = (id: string, odour: string, date: string, minutes: number, dog = 'd1'): Session => ({
  ...base, id, odour_id: odour, session_date: date, duration_s: minutes * 60, dog_id: dog,
});
const NOW = Date.parse('2026-10-05T10:00:00Z');

describe('progress line', () => {
  it('lists odours with time logged, most recently trained first, imprinted as a tick', () => {
    const sessions = [
      manual('a', 'cocaine', '2026-10-01', 75),
      manual('b', 'mdma', '2026-10-03', 42),
      manual('c', 'heroin', '2026-09-20', 30),
    ];
    expect(progressLine('d1', sessions, [], ODOURS, NOW)).toBe('MDMA 42/75 · Cocaine ✓ · Heroin 30/75');
  });

  it('orders by day, then by start time within a day', () => {
    const timed: Session = {
      ...base, id: 't', odour_id: 'tnt', kind: 'timed', session_date: '2026-10-03',
      started_at: '2026-10-03T08:00:00Z', ended_at: '2026-10-03T08:10:00Z', duration_s: 600,
    };
    const sessions = [manual('m', 'mdma', '2026-10-03', 5), timed];
    expect(trainedOdours('d1', sessions, [], ODOURS, NOW).map((o) => o.odourId)).toEqual(['tnt', 'mdma']);
  });

  it('ignores other dogs and odours with nothing logged or fully voided', () => {
    const sessions = [manual('a', 'mdma', '2026-10-03', 10), manual('b', 'tnt', '2026-10-03', 10, 'd2'), manual('v', 'heroin', '2026-10-03', 20)];
    const voided: Correction = {
      id: 'c', session_id: 'v', unit_id: 'u1', trainer_id: 'mT', void: true, new_duration_s: null,
      reason: 'x', created_at: '2026-10-04T00:00:00Z',
    };
    expect(progressLine('d1', sessions, [voided], ODOURS, NOW)).toBe('MDMA 10/75');
  });

  it('counts a running session live, and lists it even in its first second', () => {
    const running: Session = {
      ...base, id: 'r', odour_id: 'cannabis', kind: 'timed', session_date: '2026-10-05',
      started_at: '2026-10-05T09:48:00Z', duration_s: null,
    };
    expect(progressLine('d1', [running], [], ODOURS, NOW)).toBe('Cannabis 12/75');
    expect(progressLine('d1', [running], [], ODOURS, Date.parse('2026-10-05T09:48:00Z'))).toBe('Cannabis 0/75');
  });

  it('names an odour from the catalogue it is given, archived ones too, and skips ids it has never heard of', () => {
    const odours = [{ ...ODOURS.find((o) => o.id === 'mdma')!, name: 'Ecstasy', archived_at: '2026-10-02T00:00:00Z' }];
    const sessions = [manual('a', 'mdma', '2026-10-03', 10), manual('b', 'unknown', '2026-10-03', 10)];
    expect(progressLine('d1', sessions, [], odours, NOW)).toBe('Ecstasy 10/75');
  });

  it('is empty when nothing is logged', () => {
    expect(progressLine('d1', [], [], ODOURS, NOW)).toBe('');
  });
});
