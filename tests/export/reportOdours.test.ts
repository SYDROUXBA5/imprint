import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/domain/types';
import { reportOdours } from '../../src/export/reportOdours';
import { CATEGORIES, ODOURS, dogRow, pick } from '../fixtures';

const manual = (id: string, odour: string): Session => ({
  id, unit_id: 'u1', dog_id: 'd1', odour_id: odour, handler_id: 'mA', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: 60, client_clock_offset_s: null, server_received_at: null,
});
const rex = dogRow('d1', 'Rex');
const names = (list: { name: string }[]) => list.map((o) => o.name).sort();

describe('reportOdours', () => {
  const teamOdours = [pick('t1', 'cocaine'), pick('t1', 'tnt'), pick('t1', 'mdma', false), pick('t2', 'heroin')];

  it('lists what the dog\'s team trains on, and nothing from another team or an unticked odour', () => {
    expect(names(reportOdours(rex, [], { categories: CATEGORIES, odours: ODOURS, teamOdours }))).toEqual(['Cocaine', 'TNT']);
  });

  it('adds an odour the dog has time on that the team does not train, once', () => {
    const sessions = [manual('a', 'human-remains'), manual('b', 'human-remains'), manual('c', 'cocaine')];
    expect(names(reportOdours(rex, sessions, { categories: CATEGORIES, odours: ODOURS, teamOdours }))).toEqual(['Cocaine', 'Human remains', 'TNT']);
  });

  it('drops a ticked odour that has since been archived, unless the dog has time on it', () => {
    const odours = ODOURS.map((o) => (o.id === 'tnt' ? { ...o, archived_at: '2026-10-05T00:00:00Z' } : o));
    expect(names(reportOdours(rex, [], { categories: CATEGORIES, odours, teamOdours }))).toEqual(['Cocaine']);
    expect(names(reportOdours(rex, [manual('a', 'tnt')], { categories: CATEGORIES, odours, teamOdours }))).toEqual(['Cocaine', 'TNT']);
  });
});
