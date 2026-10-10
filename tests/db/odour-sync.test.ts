import { expect, it } from 'vitest';
import { BREEDS, PURPOSES } from '../../src/domain/breeds';
import { DEFAULT_CATALOGUE } from '../../src/domain/odours';
import { addUser, as, freshDb } from './harness';

// DEFAULT_CATALOGUE, BREEDS and PURPOSES in the app mirror what the database seeds and checks. If one side
// changes without the other, these fail.

it('create_unit seeds exactly DEFAULT_CATALOGUE: the categories in order, and each one\'s odours', async () => {
  const db = await freshDb();
  const U = '00000000-0000-0000-0000-0000000000a1';
  await addUser(db, U);
  await as(db, U, () => db.query(`select public.create_unit('Wells K9', 'Tess')`));
  const cats = (await db.query<{ id: string; name: string }>('select id, name from odour_categories order by sort')).rows;
  expect(cats.map((c) => c.name)).toEqual(DEFAULT_CATALOGUE.map((c) => c.name));
  for (const [i, expected] of DEFAULT_CATALOGUE.entries()) {
    const names = (await db.query<{ name: string }>('select name from odours where category_id = $1', [cats[i].id])).rows.map((r) => r.name);
    expect(names.sort(), expected.name).toEqual([...expected.odours].sort());
  }
});

it('the dogs.breed check lists exactly the BREEDS ids, and dogs.purpose exactly PURPOSES', async () => {
  const db = await freshDb();
  const def = async (name: string) =>
    (await db.query<{ def: string }>('select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1', [name])).rows[0].def;
  const ids = (sql: string) => [...sql.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1]);
  expect(ids(await def('dogs_breed_check')).sort()).toEqual(BREEDS.map((b) => b.id).sort());
  expect(ids(await def('dogs_purpose_check')).sort()).toEqual(PURPOSES.map((p) => p.id).sort());
});
