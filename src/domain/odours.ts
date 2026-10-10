import type { Catalogue, Odour, OdourCategory, TeamOdour } from './types';

/**
 * What `create_unit` seeds into the database (migration 0005), in order. The catalogue itself lives in
 * the database and is edited by trainers; this constant is the starting point, and the demo seed and
 * the tests build their rows from it. tests/db/odour-sync.test.ts keeps it equal to the SQL.
 */
export const DEFAULT_CATALOGUE: readonly { name: string; odours: readonly string[] }[] = [
  { name: 'Narcotics', odours: ['Cocaine', 'Heroin', 'Methamphetamine', 'MDMA', 'Cannabis', 'Fentanyl'] },
  {
    name: 'Explosives',
    odours: [
      'TNT', 'C4/RDX', 'PETN', 'Semtex', 'Black powder', 'Smokeless powder',
      'Ammonium nitrate', 'Det cord', 'Dynamite', 'TATP', 'HMTD',
    ],
  },
  { name: 'Cadaver', odours: ['Human remains'] },
  { name: 'Bed bugs', odours: ['Live bed bugs', 'Viable eggs'] },
];

/** Shown beside an odour that has logged time but is no longer in the team's list (spec §13.4). */
export const NOT_IN_CURRENT_LIST = '(not in current list)';

/** Local key of a team's choice about an odour. */
export const teamOdourId = (teamId: string, odourId: string): string => `${teamId}:${odourId}`;

/** Category and odour rows of the default catalogue for a unit; `id` picks the id of each row. */
export function defaultCatalogueRows(
  unitId: string, createdAt: string, id: (kind: 'category' | 'odour', name: string) => string,
): { categories: OdourCategory[]; odours: Odour[] } {
  const categories: OdourCategory[] = [];
  const odours: Odour[] = [];
  DEFAULT_CATALOGUE.forEach((c, i) => {
    const categoryId = id('category', c.name);
    categories.push({ id: categoryId, unit_id: unitId, name: c.name, sort: i + 1, created_at: createdAt, archived_at: null });
    for (const name of c.odours) {
      odours.push({ id: id('odour', name), unit_id: unitId, category_id: categoryId, name, created_at: createdAt, archived_at: null });
    }
  });
  return { categories, odours };
}

const compareNames = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export const odourById = (odours: readonly Odour[], id: string): Odour | undefined =>
  odours.find((o) => o.id === id);

/** The odour's name; the id itself for one this phone has not received. */
export const odourName = (odours: readonly Odour[], id: string): string => odourById(odours, id)?.name ?? id;

/** By name, ignoring case. Odours have no order of their own. */
export const sortOdours = (odours: readonly Odour[]): Odour[] => [...odours].sort(compareNames);

/** By their sort number, then name. */
export const sortCategories = (categories: readonly OdourCategory[]): OdourCategory[] =>
  [...categories].sort((a, b) => a.sort - b.sort || compareNames(a, b));

/** Ids of the odours a team has ticked, archived ones included (their choice is kept for a restore). */
export function selectedOdourIds(teamOdours: readonly TeamOdour[], teamId: string): Set<string> {
  return new Set(teamOdours.filter((t) => t.team_id === teamId && t.selected).map((t) => t.odour_id));
}

export interface CategoryGroup { category: OdourCategory; odours: Odour[] }

/**
 * The odours a team trains on, grouped for the dog screen: ticked, not archived, in a category that is
 * not archived. Categories with nothing to show are left out. Categories by sort, odours by name.
 */
export function teamOdourGroups(teamId: string, { categories, odours, teamOdours }: Catalogue): CategoryGroup[] {
  const selected = selectedOdourIds(teamOdours, teamId);
  return sortCategories(categories.filter((c) => c.archived_at === null))
    .map((category) => ({
      category,
      odours: sortOdours(odours.filter((o) => o.category_id === category.id && o.archived_at === null && selected.has(o.id))),
    }))
    .filter((g) => g.odours.length > 0);
}

/** False for an odour that is unticked, archived, in an archived category, or unknown: show "(not in current list)". */
export function isInTeamList(teamId: string, odourId: string, catalogue: Catalogue): boolean {
  return teamOdourGroups(teamId, catalogue).some((g) => g.odours.some((o) => o.id === odourId));
}
