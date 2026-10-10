// Shared test data for the new data model (spec §13). The catalogue rows are the default catalogue with
// readable ids ('cocaine', 'narcotics', ...), so tests can say 'mdma' and read like they did before the
// catalogue moved into the database. Ids are plain strings in the local store; only the server needs uuids.
import type { ImprintDB } from '../src/data/db';
import { defaultCatalogueRows, teamOdourId } from '../src/domain/odours';
import type { Dog, Team, TeamOdour } from '../src/domain/types';

export const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const catalogueRows = (unitId = 'u1') =>
  defaultCatalogueRows(unitId, '2026-10-01T00:00:00Z', (_kind, name) => slug(name));

export const CATEGORIES = catalogueRows().categories;
export const ODOURS = catalogueRows().odours;

export const team = (id = 't1', name = 'Alpha', archived: string | null = null, unitId = 'u1'): Team => ({
  id, unit_id: unitId, name, created_by: 'mT', created_at: '2026-10-01T00:00:00Z', archived_at: archived,
});

export const pick = (teamId: string, odourId: string, selected = true, unitId = 'u1'): TeamOdour => ({
  id: teamOdourId(teamId, odourId), team_id: teamId, odour_id: odourId, unit_id: unitId, selected,
});

/** A dog in team t1 unless said otherwise. */
export const dogRow = (id: string, name: string, over: Partial<Dog> = {}): Dog => ({
  id, unit_id: 'u1', team_id: 't1', name, breed: 'labrador', purpose: 'single', created_by: 'mT',
  created_at: '2026-10-01T00:00:00Z', archived_at: null, ...over,
});

/** Put the default catalogue and the given active teams (each training on all of it) into the local store. */
export async function seedCatalogue(db: ImprintDB, teamIds: string[] = ['t1'], unitId = 'u1'): Promise<void> {
  const { categories, odours } = catalogueRows(unitId);
  await db.odour_categories.bulkPut(categories);
  await db.odours.bulkPut(odours);
  for (const id of teamIds) {
    if (!(await db.teams.get(id))) await db.teams.put(team(id, id === 't1' ? 'Alpha' : id, null, unitId));
    await db.team_odours.bulkPut(odours.map((o) => pick(id, o.id, true, unitId)));
  }
}
