import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { addUser, applyMigrations, as, createUnit, freshDb, joinAs } from './harness';

// Migration 0008: a team's planned number of dogs. Roles from the same angles as the other team tests:
// a trainer of the unit, a handler-link phone of the unit, a trainer of another unit, and anon.

const T = '00000000-0000-0000-0000-0000000000a1'; // trainer, unit 1
const H = '00000000-0000-0000-0000-0000000000b1'; // handler, unit 1
const X = '00000000-0000-0000-0000-0000000000c1'; // trainer, unit 2
const TEAM = '30000000-0000-0000-0000-000000000001'; // unit 1, planned 6
const TEAM_OLD = '30000000-0000-0000-0000-000000000002'; // unit 1, no planned size (a legacy team)
const NEW = '30000000-0000-0000-0000-000000000009';

async function setup() {
  const db = await freshDb();
  const links = await createUnit(db, 'Wells K9');
  const otherLinks = await createUnit(db, 'Other unit');
  const t = await joinAs(db, T, links.trainer, 'Tess');
  const h = await joinAs(db, H, links.handler, 'Paul');
  const x = await joinAs(db, X, otherLinks.trainer, 'Xavier');
  await as(db, T, () => db.query(
    `insert into teams (id, unit_id, name, created_by, planned_dogs) values ($1, $2, 'Alpha', $3, 6)`, [TEAM, t.unit_id, t.id]));
  await as(db, T, () => db.query(
    `insert into teams (id, unit_id, name, created_by) values ($1, $2, 'Bravo', $3)`, [TEAM_OLD, t.unit_id, t.id]));
  return { db, links, t, h, x, unit: t.unit_id };
}

/** The planned size of a team; undefined when there is no such team row. */
const planned = async (db: PGlite, id = TEAM) =>
  (await db.query<{ planned_dogs: number | null }>('select planned_dogs from teams where id = $1', [id])).rows[0]?.planned_dogs;

const asAnon = async <R>(db: PGlite, fn: () => Promise<R>): Promise<R> => {
  await db.exec('set role anon');
  try { return await fn(); } finally { await db.exec('reset role'); }
};

const insertWith = (db: PGlite, who: string, m: { id: string }, unit: string, n: number | null, id = NEW) =>
  as(db, who, () => db.query(
    `insert into teams (id, unit_id, name, created_by, planned_dogs) values ($1, $2, 'New team', $3, $4)`, [id, unit, m.id, n]));

describe('the column', () => {
  it('is a nullable integer', async () => {
    const { db } = await setup();
    const { rows } = await db.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'teams' and column_name = 'planned_dogs'`);
    expect(rows).toEqual([{ data_type: 'integer', is_nullable: 'YES' }]);
  });

  it('a team without it stays legal: the value is null', async () => {
    const { db } = await setup();
    expect(await planned(db, TEAM_OLD)).toBeNull();
  });

  it('teams that exist before the migration keep working and have no planned size', async () => {
    const db = await freshDb(true, '0007');
    const links = await createUnit(db, 'Old unit');
    const t = await joinAs(db, T, links.trainer, 'Tess');
    await as(db, T, () => db.query(
      `insert into teams (id, unit_id, name, created_by) values ($1, $2, 'Alpha', $3)`, [TEAM, t.unit_id, t.id]));
    await applyMigrations(db, { after: '0007' });
    expect(await planned(db)).toBeNull();
    await as(db, T, () => db.query('update teams set planned_dogs = 4 where id = $1', [TEAM]));
    expect(await planned(db)).toBe(4);
  });
});

describe('an active trainer of the unit', () => {
  it('can create a team with a planned number of dogs', async () => {
    const { db, t, unit } = await setup();
    await insertWith(db, T, t, unit, 12);
    expect(await planned(db, NEW)).toBe(12);
  });

  it('can create a team without one (null is accepted)', async () => {
    const { db, t, unit } = await setup();
    await insertWith(db, T, t, unit, null);
    expect(await planned(db, NEW)).toBeNull();
  });

  it('can change it, give a legacy team one, and clear it', async () => {
    const { db } = await setup();
    const res = await as(db, T, () => db.query('update teams set planned_dogs = 8 where id = $1', [TEAM]));
    expect(res.affectedRows).toBe(1);
    expect(await planned(db)).toBe(8);
    await as(db, T, () => db.query('update teams set planned_dogs = 3 where id = $1', [TEAM_OLD]));
    expect(await planned(db, TEAM_OLD)).toBe(3);
    await as(db, T, () => db.query('update teams set planned_dogs = null where id = $1', [TEAM]));
    expect(await planned(db)).toBeNull();
  });

  it('changing it moves updated_at, so the change reaches the other phones on the next pull', async () => {
    const { db } = await setup();
    const before = (await db.query<{ u: string }>('select updated_at::text as u from teams where id = $1', [TEAM])).rows[0].u;
    await db.query(`select pg_sleep(0.01)`);
    await as(db, T, () => db.query('update teams set planned_dogs = 9 where id = $1', [TEAM]));
    const after = (await db.query<{ u: string }>('select updated_at::text as u from teams where id = $1', [TEAM])).rows[0].u;
    expect(after > before).toBe(true);
  });

  it('is refused 0 and negative numbers, on insert and on update', async () => {
    const { db, t, unit } = await setup();
    for (const bad of [0, -1, -12]) {
      await expect(insertWith(db, T, t, unit, bad)).rejects.toThrow(/check/);
      await expect(as(db, T, () => db.query('update teams set planned_dogs = $1 where id = $2', [bad, TEAM]))).rejects.toThrow(/check/);
    }
    expect(await planned(db)).toBe(6); // unchanged
    expect(await planned(db, NEW)).toBeUndefined(); // nothing inserted
  });

  it('still cannot move a team to another unit or another creator', async () => {
    const { db, x } = await setup();
    await expect(as(db, T, () => db.query(
      'update teams set unit_id = $1, planned_dogs = 5 where id = $2', [x.unit_id, TEAM]))).rejects.toThrow();
    await expect(as(db, T, () => db.query(
      'update teams set created_by = $1, planned_dogs = 5 where id = $2', [x.id, TEAM]))).rejects.toThrow(/cannot move/);
    expect(await planned(db)).toBe(6);
  });

  it('cannot create a team with a planned size on behalf of another member', async () => {
    const { db, h, unit } = await setup();
    await expect(insertWith(db, T, h, unit, 5)).rejects.toThrow(/row-level security/);
  });
});

describe('a handler-link phone', () => {
  it('cannot create a team with a planned number of dogs', async () => {
    const { db, h, unit } = await setup();
    await expect(insertWith(db, H, h, unit, 6)).rejects.toThrow(/row-level security/);
    await expect(insertWith(db, H, h, unit, null)).rejects.toThrow(/row-level security/);
    expect(await planned(db, NEW)).toBeUndefined();
  });

  it('cannot change it, and the row is unchanged afterwards', async () => {
    const { db } = await setup();
    const before = (await db.query('select * from teams where id = $1', [TEAM])).rows[0];
    const res = await as(db, H, () => db.query('update teams set planned_dogs = 99 where id = $1', [TEAM]));
    expect(res.affectedRows ?? 0).toBe(0);
    const legacy = await as(db, H, () => db.query('update teams set planned_dogs = 99 where id = $1', [TEAM_OLD]));
    expect(legacy.affectedRows ?? 0).toBe(0);
    const sweep = await as(db, H, () => db.query('update teams set planned_dogs = 99'));
    expect(sweep.affectedRows ?? 0).toBe(0);
    expect((await db.query('select * from teams where id = $1', [TEAM])).rows[0]).toEqual(before);
    expect(await planned(db)).toBe(6);
    expect(await planned(db, TEAM_OLD)).toBeNull();
  });

  it('can read it', async () => {
    const { db } = await setup();
    const rows = (await as(db, H, () => db.query<{ id: string; planned_dogs: number | null }>(
      'select id, planned_dogs from teams order by name'))).rows;
    expect(rows).toEqual([{ id: TEAM, planned_dogs: 6 }, { id: TEAM_OLD, planned_dogs: null }]);
  });
});

describe('a trainer of another unit', () => {
  it('cannot create a team of this unit with a planned size', async () => {
    const { db, x, unit } = await setup();
    await expect(insertWith(db, X, x, unit, 6)).rejects.toThrow(/row-level security/);
    expect(await planned(db, NEW)).toBeUndefined();
  });

  it('cannot change it, and cannot even see the team', async () => {
    const { db } = await setup();
    const before = (await db.query('select * from teams where id = $1', [TEAM])).rows[0];
    const res = await as(db, X, () => db.query('update teams set planned_dogs = 99 where id = $1', [TEAM]));
    expect(res.affectedRows ?? 0).toBe(0);
    expect((await db.query('select * from teams where id = $1', [TEAM])).rows[0]).toEqual(before);
    expect((await as(db, X, () => db.query('select planned_dogs from teams where id = $1', [TEAM]))).rows).toHaveLength(0);
  });
});

describe('a trainer phone that lost its access', () => {
  it('cannot change it once its trainer link was replaced', async () => {
    const { db, links } = await setup();
    const T2 = '00000000-0000-0000-0000-0000000000a2';
    await joinAs(db, T2, links.trainer, 'Tina');
    await as(db, T, () => db.query(`select public.regenerate_link('trainer')`)); // Tess keeps access, Tina does not
    const res = await as(db, T2, () => db.query('update teams set planned_dogs = 99 where id = $1', [TEAM]));
    expect(res.affectedRows ?? 0).toBe(0);
    expect(await planned(db)).toBe(6);
  });
});

describe('anon', () => {
  it('cannot create a team with a planned size', async () => {
    const { db, t, unit } = await setup();
    await expect(asAnon(db, () => db.query(
      `insert into teams (id, unit_id, name, created_by, planned_dogs) values ($1, $2, 'New team', $3, 6)`, [NEW, unit, t.id],
    ))).rejects.toThrow(/row-level security|permission denied/);
    expect(await planned(db, NEW)).toBeUndefined();
  });

  it('cannot change it or read it', async () => {
    const { db } = await setup();
    const res = await asAnon(db, () => db.query('update teams set planned_dogs = 99 where id = $1', [TEAM]));
    expect(res.affectedRows ?? 0).toBe(0);
    expect(await planned(db)).toBe(6);
    expect((await asAnon(db, () => db.query('select planned_dogs from teams'))).rows).toHaveLength(0);
  });

  it('a phone that never opened a link cannot either', async () => {
    const { db, t, unit } = await setup();
    const N = '00000000-0000-0000-0000-0000000000d1';
    await addUser(db, N);
    await expect(insertWith(db, N, t, unit, 6)).rejects.toThrow(/row-level security/);
    const res = await as(db, N, () => db.query('update teams set planned_dogs = 99 where id = $1', [TEAM]));
    expect(res.affectedRows ?? 0).toBe(0);
    expect(await planned(db)).toBe(6);
  });
});

describe('realtime', () => {
  it('teams is already published with every column, so planned_dogs needs no publication change', async () => {
    const { db } = await setup();
    const { rows } = await db.query<{ attnames: string[] | null }>(
      `select attnames from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].attnames).toContain('planned_dogs');
  });
});
