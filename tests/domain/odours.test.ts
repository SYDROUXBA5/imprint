import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOGUE, defaultCatalogueRows, odourById, odourName, sortCategories, sortOdours,
  teamOdourGroups, teamOdourId, isInTeamList, selectedOdourIds,
} from '../../src/domain/odours';
import type { Catalogue, Odour, OdourCategory, TeamOdour } from '../../src/domain/types';

const cat = (id: string, name: string, sort: number, archived = false): OdourCategory =>
  ({ id, unit_id: 'u1', name, sort, created_at: '', archived_at: archived ? '2026-10-01T00:00:00Z' : null });
const odour = (id: string, categoryId: string, name: string, archived = false): Odour =>
  ({ id, unit_id: 'u1', category_id: categoryId, name, created_at: '', archived_at: archived ? '2026-10-01T00:00:00Z' : null });
const pick = (teamId: string, odourId: string, selected = true): TeamOdour =>
  ({ id: teamOdourId(teamId, odourId), team_id: teamId, odour_id: odourId, unit_id: 'u1', selected });

describe('DEFAULT_CATALOGUE (spec §13.4)', () => {
  it('has the four seeded categories in order, with 6, 11, 1 and 2 odours', () => {
    expect(DEFAULT_CATALOGUE.map((c) => [c.name, c.odours.length])).toEqual([
      ['Narcotics', 6], ['Explosives', 11], ['Cadaver', 1], ['Bed bugs', 2],
    ]);
  });

  it('keeps the spec names and order', () => {
    expect(DEFAULT_CATALOGUE[0].odours).toEqual(['Cocaine', 'Heroin', 'Methamphetamine', 'MDMA', 'Cannabis', 'Fentanyl']);
    expect(DEFAULT_CATALOGUE[2].odours).toEqual(['Human remains']);
    expect(DEFAULT_CATALOGUE[3].odours).toEqual(['Live bed bugs', 'Viable eggs']);
  });

  it('has no duplicate names within a category, ignoring case', () => {
    for (const c of DEFAULT_CATALOGUE) {
      const names = c.odours.map((n) => n.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe('defaultCatalogueRows', () => {
  it('builds category and odour rows for a unit, with ids from the callback', () => {
    const rows = defaultCatalogueRows('u9', '2026-10-01T00:00:00.000Z', (kind, name) => `${kind}:${name}`);
    expect(rows.categories.map((c) => [c.id, c.sort])).toEqual([
      ['category:Narcotics', 1], ['category:Explosives', 2], ['category:Cadaver', 3], ['category:Bed bugs', 4],
    ]);
    expect(rows.odours).toHaveLength(20);
    expect(rows.odours.find((o) => o.name === 'TATP')).toEqual({
      id: 'odour:TATP', unit_id: 'u9', category_id: 'category:Explosives', name: 'TATP',
      created_at: '2026-10-01T00:00:00.000Z', archived_at: null,
    });
    expect(rows.categories.every((c) => c.unit_id === 'u9' && c.archived_at === null)).toBe(true);
  });
});

describe('lookups and ordering', () => {
  const odours = [odour('o1', 'c1', 'Zebra'), odour('o2', 'c1', 'apple'), odour('o3', 'c1', 'Mango')];

  it('finds an odour by id and gives its name, falling back to the id for one that is not here', () => {
    expect(odourById(odours, 'o3')?.name).toBe('Mango');
    expect(odourById(odours, 'nope')).toBeUndefined();
    expect(odourName(odours, 'o3')).toBe('Mango');
    expect(odourName(odours, 'nope')).toBe('nope');
  });

  it('sorts odours by name, ignoring case', () => {
    expect(sortOdours(odours).map((o) => o.name)).toEqual(['apple', 'Mango', 'Zebra']);
    expect(odours.map((o) => o.name)).toEqual(['Zebra', 'apple', 'Mango']); // the input is untouched
  });

  it('sorts categories by their sort number, then name', () => {
    const cats = [cat('c3', 'B', 2), cat('c1', 'Z', 1), cat('c2', 'A', 2)];
    expect(sortCategories(cats).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('what a team trains on (spec §13.4)', () => {
  const catalogue: Catalogue = {
    categories: [cat('narc', 'Narcotics', 1), cat('expl', 'Explosives', 2), cat('cad', 'Cadaver', 3), cat('old', 'Retired', 4, true)],
    odours: [
      odour('coke', 'narc', 'Cocaine'), odour('mdma', 'narc', 'MDMA'), odour('heroin', 'narc', 'Heroin', true),
      odour('tnt', 'expl', 'TNT'), odour('human', 'cad', 'Human remains'), odour('ghost', 'old', 'Ghost'),
    ],
    teamOdours: [
      pick('t1', 'mdma'), pick('t1', 'coke'), pick('t1', 'heroin'), pick('t1', 'tnt', false), pick('t1', 'ghost'),
      pick('t2', 'human'),
    ],
  };

  it('groups the selected, non-archived odours by category, in category order, odours by name', () => {
    expect(teamOdourGroups('t1', catalogue).map((g) => [g.category.name, g.odours.map((o) => o.name)])).toEqual([
      ['Narcotics', ['Cocaine', 'MDMA']],
    ]);
  });

  it('leaves out a category with nothing selected, an archived odour, an unticked odour and an archived category', () => {
    const names = teamOdourGroups('t1', catalogue).flatMap((g) => g.odours.map((o) => o.name));
    expect(names).not.toContain('Heroin'); // archived odour, still ticked
    expect(names).not.toContain('TNT'); // unticked
    expect(names).not.toContain('Ghost'); // its category is archived
    expect(teamOdourGroups('t1', catalogue).map((g) => g.category.name)).not.toContain('Explosives');
  });

  it('is per team, and empty for a team with no choices', () => {
    expect(teamOdourGroups('t2', catalogue).map((g) => g.category.name)).toEqual(['Cadaver']);
    expect(teamOdourGroups('nobody', catalogue)).toEqual([]);
  });

  it('knows which odours are selected for a team, archived ones included', () => {
    expect([...selectedOdourIds(catalogue.teamOdours, 't1')].sort()).toEqual(['coke', 'ghost', 'heroin', 'mdma']);
  });

  it('says whether an odour is in the team\'s current list ("(not in current list)" otherwise)', () => {
    expect(isInTeamList('t1', 'coke', catalogue)).toBe(true);
    expect(isInTeamList('t1', 'tnt', catalogue)).toBe(false); // unticked
    expect(isInTeamList('t1', 'heroin', catalogue)).toBe(false); // archived
    expect(isInTeamList('t1', 'ghost', catalogue)).toBe(false); // category archived
    expect(isInTeamList('t1', 'unknown', catalogue)).toBe(false);
  });

  it('keys a team choice by team and odour', () => {
    expect(teamOdourId('t1', 'coke')).toBe('t1:coke');
  });
});
