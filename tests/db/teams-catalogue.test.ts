import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { addUser, applyMigrations, as, createUnit, freshDb, joinAs } from './harness';

// Spec §13: teams, dog breed/purpose, odour catalogue. Roles from three angles everywhere:
// a handler and a trainer of the unit, and a trainer of a different unit.

const T = '00000000-0000-0000-0000-0000000000a1'; // trainer, unit 1
const H = '00000000-0000-0000-0000-0000000000b1'; // handler, unit 1
const X = '00000000-0000-0000-0000-0000000000c1'; // trainer, unit 2 (another organisation)
const TEAM = '30000000-0000-0000-0000-000000000001'; // unit 1, active
const TEAM2 = '30000000-0000-0000-0000-000000000002'; // unit 1, active
const XTEAM = '30000000-0000-0000-0000-000000000003'; // unit 2
const DOG = '10000000-0000-0000-0000-000000000001'; // unit 1, in TEAM
const XDOG = '10000000-0000-0000-0000-000000000003'; // unit 2, in XTEAM

async function setup() {
  const db = await freshDb();
  const links = await createUnit(db, 'Wells K9');
  const otherLinks = await createUnit(db, 'Other unit');
  const t = await joinAs(db, T, links.trainer, 'Tess');
  const h = await joinAs(db, H, links.handler, 'Paul');
  const x = await joinAs(db, X, otherLinks.trainer, 'Xavier');
  const unit = t.unit_id, xUnit = x.unit_id;
  const team = (user: string, m: { id: string; unit_id: string }, id: string, name: string) => as(db, user, () => db.query(
    `insert into teams (id, unit_id, name, created_by) values ($1, $2, $3, $4)`, [id, m.unit_id, name, m.id]));
  await team(T, t, TEAM, 'Alpha');
  await team(T, t, TEAM2, 'Bravo');
  await team(X, x, XTEAM, 'Xray');
  const dog = (user: string, m: { id: string; unit_id: string }, id: string, name: string, teamId: string) => as(db, user, () => db.query(
    `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose) values ($1, $2, $3, $4, $5, 'malinois', 'dual')`,
    [id, m.unit_id, name, m.id, teamId]));
  await dog(T, t, DOG, 'Rex', TEAM);
  await dog(X, x, XDOG, 'Ace', XTEAM);
  const odoursOf = async (u: string) => Object.fromEntries((await db.query<{ id: string; name: string }>(
    'select id, name from odours where unit_id = $1', [u])).rows.map((r) => [r.name, r.id]));
  const o1 = await odoursOf(unit), o2 = await odoursOf(xUnit); // odour ids by name, per unit
  return { db, t, h, x, links, unit, xUnit, o1, o2 };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const count = async (db: PGlite, sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0].n);

const insertTimed = (db: PGlite, id: string, unit: string, dog: string, odour: string, handler: string, startedAt = '2026-10-03T10:00:00Z') =>
  db.query(
    `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, client_sent_at)
     values ($1, $2, $3, $4, $5, 'timed', '2026-10-03', $6, now())`,
    [id, unit, dog, odour, handler, startedAt]);

// ───────── The default catalogue ─────────

describe('setup_unit seeds the odour catalogue', () => {
  it('four categories, in order, with the odours of spec §13.4', async () => {
    const { db, unit } = await setup();
    const cats = (await db.query<{ id: string; name: string }>(
      'select id, name from odour_categories where unit_id = $1 order by sort', [unit])).rows;
    expect(cats.map((c) => c.name)).toEqual(['Narcotics', 'Explosives', 'Cadaver', 'Bed bugs']);
    const odoursOf = async (cat: string) => (await db.query<{ name: string }>(
      'select name from odours where category_id = $1 order by name', [cats.find((c) => c.name === cat)!.id])).rows.map((r) => r.name);
    expect(await odoursOf('Narcotics')).toHaveLength(6);
    expect(await odoursOf('Explosives')).toHaveLength(11);
    expect(await odoursOf('Cadaver')).toEqual(['Human remains']);
    expect(await odoursOf('Bed bugs')).toEqual(['Live bed bugs', 'Viable eggs']);
    expect(await odoursOf('Narcotics')).toContain('MDMA');
    expect(await odoursOf('Explosives')).toContain('C4/RDX');
  });

  it('every unit gets its own copy, nothing archived', async () => {
    const { db, unit, xUnit } = await setup();
    for (const u of [unit, xUnit]) {
      expect(await count(db, 'odour_categories where unit_id = $1 and archived_at is null', [u])).toBe(4);
      expect(await count(db, 'odours where unit_id = $1 and archived_at is null', [u])).toBe(20);
    }
    expect(await count(db, 'odours')).toBe(40);
    // A fresh unit has no teams: the trainer makes the first.
    expect(await count(db, 'teams where unit_id = $1', [xUnit])).toBe(1);
  });
});

describe('names are unique per unit, case-insensitively', () => {
  it('categories', async () => {
    const { db, unit } = await setup();
    const add = (name: string) => as(db, T, () => db.query(
      `insert into odour_categories (id, unit_id, name, sort) values (gen_random_uuid(), $1, $2, 9)`, [unit, name]));
    await expect(add('narcotics')).rejects.toThrow(/unique/);
    await expect(add('  CADAVER ')).rejects.toThrow(/unique/);
    await add('Currency');
    await expect(add('currency')).rejects.toThrow(/unique/);
  });

  it('odours within a category, but the same name may live in another category or unit', async () => {
    const { db, unit } = await setup();
    const cats = Object.fromEntries((await db.query<{ id: string; name: string }>(
      'select id, name from odour_categories where unit_id = $1', [unit])).rows.map((c) => [c.name, c.id]));
    const add = (cat: string, name: string) => as(db, T, () => db.query(
      `insert into odours (id, unit_id, category_id, name) values (gen_random_uuid(), $1, $2, $3)`, [unit, cat, name]));
    await expect(add(cats.Narcotics, 'cocaine')).rejects.toThrow(/unique/);
    await expect(add(cats.Narcotics, ' COCAINE ')).rejects.toThrow(/unique/);
    await add(cats.Explosives, 'Cocaine'); // other category: fine
    await add(cats.Narcotics, 'Ketamine');
    expect(await count(db, 'odours where unit_id = $1 and name = $2', [unit, 'Ketamine'])).toBe(1);
  });

  it('an archived name still counts, so restoring never collides', async () => {
    const { db, unit, o1 } = await setup();
    const id = o1.Cocaine;
    await as(db, T, () => db.query(`update odours set archived_at = now() where id = $1`, [id]));
    const cat = (await db.query<{ category_id: string }>('select category_id from odours where id = $1', [id])).rows[0].category_id;
    await expect(as(db, T, () => db.query(
      `insert into odours (id, unit_id, category_id, name) values (gen_random_uuid(), $1, $2, 'Cocaine')`, [unit, cat]),
    )).rejects.toThrow(/unique/);
  });
});

// ───────── Who can read ─────────

describe('reading', () => {
  const tables = ['teams', 'odour_categories', 'odours', 'dogs'];

  it('a handler reads the unit’s teams, dogs and catalogue', async () => {
    const { db, unit, o1 } = await setup();
    await as(db, T, () => db.query(
      `insert into team_odours (team_id, odour_id, unit_id, selected) values ($1, $2, $3, true)`, [TEAM, o1.Cocaine, unit]));
    const n = (sql: string) => as(db, H, () => db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).then((r) => r.rows[0].n);
    expect(await n('teams')).toBe(2);
    expect(await n('dogs')).toBe(1);
    expect(await n('odour_categories')).toBe(4);
    expect(await n('odours')).toBe(20);
    expect(await n('team_odours')).toBe(1);
  });

  it('a member of another unit reads none of it, including the tombstones', async () => {
    const { db, unit, t, o1 } = await setup();
    await as(db, T, () => db.query(
      `insert into team_odours (team_id, odour_id, unit_id, selected) values ($1, $2, $3, true)`, [TEAM, o1.Cocaine, unit]));
    await db.query(`insert into deleted_teams (team_id, unit_id, deleted_by) values (gen_random_uuid(), $1, $2)`, [unit, t.id]);
    // X has its own rows in these tables, so look for unit 1's specifically.
    for (const table of [...tables, 'team_odours', 'deleted_teams']) {
      const rows = await as(db, X, () => db.query<{ unit_id: string }>(`select unit_id from ${table}`));
      expect(rows.rows.filter((r) => r.unit_id === unit), table).toHaveLength(0);
    }
    expect(await as(db, X, () => db.query('select 1 from team_odours'))).toHaveProperty('rows', []);
  });
});

// ───────── Who can write ─────────

describe('writing: only active trainers of the unit', () => {
  interface Case {
    table: string;
    insert: (c: Ctx, member: string, unit: string, ids: { team: string; odour: string; cat: string }) => { sql: string; params: unknown[] };
    update: string; // changes one visible value on a unit-1 row
    probe: string; // reads that value back
    changed: unknown;
  }
  const cases: Case[] = [
    {
      table: 'teams',
      insert: (_c, member, unit) => ({
        sql: `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'New team', $2)`, params: [unit, member] }),
      update: `update teams set name = 'Renamed' where id = '${TEAM}'`,
      probe: `select name as v from teams where id = '${TEAM}'`, changed: 'Renamed',
    },
    {
      table: 'dogs',
      insert: (_c, member, unit, ids) => ({
        sql: `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose)
              values (gen_random_uuid(), $1, 'New dog', $2, $3, 'labrador', 'single')`, params: [unit, member, ids.team] }),
      update: `update dogs set breed = 'hound' where id = '${DOG}'`,
      probe: `select breed as v from dogs where id = '${DOG}'`, changed: 'hound',
    },
    {
      table: 'odour_categories',
      insert: (_c, _m, unit) => ({
        sql: `insert into odour_categories (id, unit_id, name, sort) values (gen_random_uuid(), $1, 'New category', 9)`, params: [unit] }),
      update: `update odour_categories set name = 'Renamed' where name = 'Cadaver' and unit_id = (select unit_id from teams where id = '${TEAM}')`,
      probe: `select count(*)::int as v from odour_categories where name = 'Renamed'`, changed: 1,
    },
    {
      table: 'odours',
      insert: (_c, _m, unit, ids) => ({
        sql: `insert into odours (id, unit_id, category_id, name) values (gen_random_uuid(), $1, $2, 'New odour')`, params: [unit, ids.cat] }),
      update: `update odours set archived_at = now() where name = 'Cocaine' and unit_id = (select unit_id from teams where id = '${TEAM}')`,
      probe: `select count(*)::int as v from odours where archived_at is not null`, changed: 1,
    },
    {
      table: 'team_odours',
      insert: (_c, _m, unit, ids) => ({
        sql: `insert into team_odours (team_id, odour_id, unit_id, selected) values ($2, $3, $1, true)`, params: [unit, ids.team, ids.odour] }),
      update: `update team_odours set selected = false where team_id = '${TEAM}'
               and odour_id in (select id from odours where name = 'Cocaine')`,
      probe: `select count(*)::int as v from team_odours where selected = false`, changed: 1,
    },
  ];

  for (const k of cases) {
    describe(k.table, () => {
      async function prepared() {
        const c = await setup();
        const cat = (await c.db.query<{ id: string }>(`select id from odour_categories where unit_id = $1 and name = 'Narcotics'`, [c.unit])).rows[0].id;
        const ids = { team: TEAM, odour: c.o1.MDMA, cat };
        // one team_odours row to update, whatever the table under test
        await c.db.query(`insert into team_odours (team_id, odour_id, unit_id, selected) values ($1, $2, $3, true)`, [TEAM, c.o1.Cocaine, c.unit]);
        return { c, ids };
      }
      const probe = async (db: PGlite) => (await db.query<{ v: unknown }>(k.probe)).rows[0]?.v;

      it('a handler cannot insert, update or delete', async () => {
        const { c, ids } = await prepared();
        const ins = k.insert(c, c.h.id, c.unit, ids);
        await expect(as(c.db, H, () => c.db.query(ins.sql, ins.params))).rejects.toThrow(/row-level security/);
        const before = await probe(c.db);
        expect((await as(c.db, H, () => c.db.query(k.update))).affectedRows ?? 0).toBe(0);
        expect(await probe(c.db)).toEqual(before);
        const del = await as(c.db, H, () => c.db.query(`delete from ${k.table}`));
        expect(del.affectedRows ?? 0).toBe(0);
      });

      it('a trainer of another unit cannot insert, update or delete the unit’s rows', async () => {
        const { c, ids } = await prepared();
        const ins = k.insert(c, c.x.id, c.unit, ids); // claims unit 1
        await expect(as(c.db, X, () => c.db.query(ins.sql, ins.params))).rejects.toThrow(/row-level security/);
        const before = await probe(c.db);
        expect((await as(c.db, X, () => c.db.query(k.update))).affectedRows ?? 0).toBe(0);
        expect(await probe(c.db)).toEqual(before);
        const unit1Rows = await count(c.db, `${k.table} where unit_id = $1`, [c.unit]);
        await as(c.db, X, () => c.db.query(`delete from ${k.table}`));
        expect(await count(c.db, `${k.table} where unit_id = $1`, [c.unit])).toBe(unit1Rows);
      });

      it('a trainer of the unit can insert and update, but not delete', async () => {
        const { c, ids } = await prepared();
        const ins = k.insert(c, c.t.id, c.unit, ids);
        const before = await count(c.db, k.table);
        await as(c.db, T, () => c.db.query(ins.sql, ins.params));
        expect(await count(c.db, k.table)).toBe(before + 1);
        expect((await as(c.db, T, () => c.db.query(k.update))).affectedRows).toBeGreaterThanOrEqual(1);
        expect(await probe(c.db)).toEqual(k.changed);
        const del = await as(c.db, T, () => c.db.query(`delete from ${k.table}`));
        expect(del.affectedRows ?? 0).toBe(0);
        expect(await count(c.db, k.table)).toBe(before + 1);
      });
    });
  }

  it('tombstones are written only by the delete functions: nobody inserts one', async () => {
    const { db, t, unit } = await setup();
    for (const user of [T, H, X]) {
      await expect(as(db, user, () => db.query(
        `insert into deleted_teams (team_id, unit_id, deleted_by) values (gen_random_uuid(), $1, $2)`, [unit, t.id]),
      )).rejects.toThrow(/row-level security/);
    }
  });

  it('a trainer cannot create a team on behalf of another member', async () => {
    const { db, h, unit } = await setup();
    await expect(as(db, T, () => db.query(
      `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Fake', $2)`, [unit, h.id]),
    )).rejects.toThrow(/row-level security/);
  });

  it('a removed trainer can write nothing', async () => {
    const { db, links, unit } = await setup();
    const T2 = '00000000-0000-0000-0000-0000000000a2';
    const tina = await joinAs(db, T2, links.trainer, 'Tina'); // a second trainer phone ...
    await as(db, T, () => db.query('select public.remove_member($1)', [tina.id])); // ... and her name is removed
    await expect(as(db, T2, () => db.query(
      `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Late', $2)`, [unit, tina.id]),
    )).rejects.toThrow(/row-level security/);
  });

  it('a phone whose trainer link was replaced can write nothing', async () => {
    const { db, links, unit } = await setup();
    const T2 = '00000000-0000-0000-0000-0000000000a2';
    const tina = await joinAs(db, T2, links.trainer, 'Tina');
    await as(db, T, () => db.query(`select public.regenerate_link('trainer')`)); // Tess keeps access, Tina does not
    await expect(as(db, T2, () => db.query(
      `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Late', $2)`, [unit, tina.id]),
    )).rejects.toThrow(/row-level security/);
  });

  it('teams, categories and odours keep their unit (and an odour its category) for good', async () => {
    const { db, x, xUnit, unit } = await setup();
    await expect(as(db, T, () => db.query(`update teams set unit_id = $1 where id = $2`, [xUnit, TEAM]))).rejects.toThrow();
    await expect(as(db, T, () => db.query(`update teams set created_by = $1 where id = $2`, [x.id, TEAM]))).rejects.toThrow();
    await expect(as(db, T, () => db.query(`update odour_categories set unit_id = $1 where unit_id = $2`, [xUnit, unit]))).rejects.toThrow();
    const [a, b] = (await db.query<{ id: string }>(`select id from odour_categories where unit_id = $1 limit 2`, [unit])).rows;
    await expect(as(db, T, () => db.query(
      `update odours set category_id = $1 where category_id = $2`, [a.id, b.id]))).rejects.toThrow(/cannot move/);
  });
});

// ───────── Sessions and the catalogue ─────────

describe('sessions reference the catalogue', () => {
  it('a handler adds time: start, stop own, manual — and cannot stop anyone else’s', async () => {
    const { db, h, t, unit, o1 } = await setup();
    const mdma = o1.MDMA;
    const S = '20000000-0000-0000-0000-000000000001';
    await as(db, H, () => insertTimed(db, S, unit, DOG, mdma, h.id));
    await as(db, H, () => db.query(`update sessions set ended_at = '2026-10-03T10:12:00Z', duration_s = 720 where id = $1`, [S]));
    expect((await db.query<{ duration_s: number }>('select duration_s from sessions where id = $1', [S])).rows[0].duration_s).toBe(720);
    await as(db, H, () => db.query(
      `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, duration_s)
       values (gen_random_uuid(), $1, $2, $3, $4, 'manual', '2026-10-02', 600)`, [unit, DOG, mdma, h.id]));
    const S2 = '20000000-0000-0000-0000-000000000002';
    await as(db, T, () => insertTimed(db, S2, unit, DOG, mdma, t.id));
    const res = await as(db, H, () => db.query(`update sessions set ended_at = now(), duration_s = 1 where id = $1`, [S2]));
    expect(res.affectedRows ?? 0).toBe(0);
  });

  it('a handler cannot log time as someone else', async () => {
    const { db, t, unit, o1 } = await setup();
    await expect(as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000003', unit, DOG, o1.MDMA, t.id)))
      .rejects.toThrow();
  });

  it('the odour must exist and belong to the session’s unit', async () => {
    const { db, h, x, unit, xUnit, o1, o2 } = await setup();
    const theirs = o2.MDMA;
    // Unit 1's handler, unit 1's dog, but unit 2's odour.
    await expect(as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000004', unit, DOG, theirs, h.id)))
      .rejects.toThrow(/foreign key/);
    // Unit 2's trainer claiming unit 2 with unit 1's odour.
    await expect(as(db, X, () => insertTimed(db, '20000000-0000-0000-0000-000000000005', xUnit, XDOG, o1.MDMA, x.id)))
      .rejects.toThrow(/foreign key/);
    await expect(as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000006', unit, DOG, '99999999-0000-0000-0000-000000000000', h.id)))
      .rejects.toThrow(/foreign key|invalid input/);
    // Legacy text ids are gone.
    await expect(as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000007', unit, DOG, 'mdma', h.id))).rejects.toThrow();
  });

  it('the odour of a session never changes', async () => {
    const { db, h, unit, o1 } = await setup();
    const S = '20000000-0000-0000-0000-000000000008';
    await as(db, H, () => insertTimed(db, S, unit, DOG, o1.MDMA, h.id));
    await expect(as(db, H, () => db.query(
      `update sessions set odour_id = $1, ended_at = now(), duration_s = 5 where id = $2`, [o1.Cocaine, S]),
    )).rejects.toThrow(/only ended_at/);
  });
});

// ───────── Dogs: team, breed, purpose ─────────

describe('dogs belong to a team and carry breed and purpose', () => {
  const BREEDS = ['malinois', 'german-shepherd', 'dutch-shepherd', 'labrador', 'golden-retriever', 'bloodhound', 'hound', 'springer-spaniel', 'other'];

  async function addDog(c: Ctx, over: { team?: string | null; breed?: string | null; purpose?: string | null; unit?: string } = {}) {
    const has = (k: keyof typeof over, d: unknown) => (k in over ? over[k] : d);
    return as(c.db, T, () => c.db.query(
      `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose) values (gen_random_uuid(), $1, 'Pup', $2, $3, $4, $5)`,
      [has('unit', c.unit), c.t.id, has('team', TEAM), has('breed', 'labrador'), has('purpose', 'single')]));
  }

  it('team, breed and purpose are all required', async () => {
    const c = await setup();
    await expect(addDog(c, { team: null })).rejects.toThrow(/null value/);
    await expect(addDog(c, { breed: null })).rejects.toThrow(/null value/);
    await expect(addDog(c, { purpose: null })).rejects.toThrow(/null value/);
  });

  it('breed is one of the nine ids, purpose single or dual', async () => {
    const c = await setup();
    for (const breed of BREEDS) await addDog(c, { breed });
    await expect(addDog(c, { breed: 'poodle' })).rejects.toThrow(/check/);
    await addDog(c, { purpose: 'single' });
    await addDog(c, { purpose: 'dual' });
    await expect(addDog(c, { purpose: 'triple' })).rejects.toThrow(/check/);
  });

  it('a dog’s team must be in the dog’s unit', async () => {
    const c = await setup();
    await expect(addDog(c, { team: XTEAM })).rejects.toThrow(/foreign key/);
    await expect(addDog(c, { team: '99999999-0000-0000-0000-000000000000' })).rejects.toThrow(/foreign key/);
  });

  it('a trainer moves a dog to another active team of the unit; not to an archived or foreign team', async () => {
    const c = await setup();
    const move = (user: string, team: string) => as(c.db, user, () => c.db.query(`update dogs set team_id = $1 where id = $2`, [team, DOG]));
    await move(T, TEAM2);
    expect((await c.db.query<{ team_id: string }>('select team_id from dogs where id = $1', [DOG])).rows[0].team_id).toBe(TEAM2);
    await expect(move(T, XTEAM)).rejects.toThrow(/foreign key/);
    await as(c.db, T, () => c.db.query(`update teams set archived_at = now() where id = $1`, [TEAM]));
    await expect(move(T, TEAM)).rejects.toThrow(/archived/);
    // ... and a new dog cannot be added to an archived team either
    await expect(addDog(c, { team: TEAM })).rejects.toThrow(/archived/);
    // Nobody else moves it.
    expect((await move(H, TEAM2)).affectedRows ?? 0).toBe(0);
    expect((await move(X, TEAM2)).affectedRows ?? 0).toBe(0);
  });

  it('breed, purpose and name are editable by a trainer only', async () => {
    const c = await setup();
    const edit = (user: string) => as(c.db, user, () => c.db.query(
      `update dogs set name = 'Rexy', breed = 'bloodhound', purpose = 'single' where id = $1`, [DOG]));
    expect((await edit(H)).affectedRows ?? 0).toBe(0);
    expect((await edit(X)).affectedRows ?? 0).toBe(0);
    expect((await edit(T)).affectedRows).toBe(1);
  });
});

// ───────── Archiving a team ─────────

describe('archiving a team', () => {
  const archive = (db: PGlite, user: string, id = TEAM) =>
    as(db, user, () => db.query(`update teams set archived_at = now() where id = $1`, [id]));

  it('is refused while a dog of the team has a running timer, and allowed once it stops', async () => {
    const { db, h, unit, o1 } = await setup();
    const S = '20000000-0000-0000-0000-0000000000a1';
    await as(db, H, () => insertTimed(db, S, unit, DOG, o1.MDMA, h.id));
    await expect(archive(db, T)).rejects.toThrow(/running timer/);
    await expect(archive(db, T, TEAM2)).resolves.toBeTruthy(); // another team is unaffected
    await as(db, H, () => db.query(`update sessions set ended_at = now(), duration_s = 5 where id = $1`, [S]));
    await archive(db, T);
    expect(await count(db, 'teams where id = $1 and archived_at is not null', [TEAM])).toBe(1);
  });

  it('a trainer’s void correction closes a forgotten timer, so it no longer blocks', async () => {
    const { db, t, h, unit, o1 } = await setup();
    const S = '20000000-0000-0000-0000-0000000000a2';
    await as(db, H, () => insertTimed(db, S, unit, DOG, o1.MDMA, h.id));
    await as(db, T, () => db.query(
      `insert into corrections (id, session_id, unit_id, trainer_id, void, reason) values (gen_random_uuid(), $1, $2, $3, true, 'forgot')`,
      [S, unit, t.id]));
    await archive(db, T);
  });

  it('can be restored', async () => {
    const { db } = await setup();
    await archive(db, T);
    await as(db, T, () => db.query(`update teams set archived_at = null where id = $1`, [TEAM]));
    expect(await count(db, 'teams where id = $1 and archived_at is null', [TEAM])).toBe(1);
  });

  it('is refused for handlers and for another unit’s trainer (no row changes)', async () => {
    const { db } = await setup();
    expect((await archive(db, H)).affectedRows ?? 0).toBe(0);
    expect((await archive(db, X)).affectedRows ?? 0).toBe(0);
    expect(await count(db, 'teams where archived_at is not null')).toBe(0);
  });
});

// ───────── delete_team_forever ─────────

describe('delete_team_forever', () => {
  const archive = (db: PGlite, id = TEAM) => as(db, T, () => db.query(`update teams set archived_at = now() where id = $1`, [id]));
  const del = (db: PGlite, user: string, team = TEAM) => as(db, user, () => db.query(`select public.delete_team_forever($1)`, [team]));
  const DOG2 = '10000000-0000-0000-0000-000000000004'; // second dog in TEAM
  const KEEPER = '10000000-0000-0000-0000-000000000005'; // dog in TEAM2, must survive

  /** TEAM holds DOG and DOG2, each with a stopped session, a correction and a team_odours row; TEAM2 holds KEEPER. */
  async function withHistory() {
    const c = await setup();
    const { db, t, h, unit, o1 } = c;
    const dog = (id: string, name: string, team: string) => as(db, T, () => db.query(
      `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose) values ($1, $2, $3, $4, $5, 'hound', 'dual')`,
      [id, unit, name, t.id, team]));
    await dog(DOG2, 'Fly', TEAM);
    await dog(KEEPER, 'Moss', TEAM2);
    for (const [i, d] of [DOG, DOG2, KEEPER].entries()) {
      const S = `20000000-0000-0000-0000-0000000001${i}0`;
      await as(db, H, () => insertTimed(db, S, unit, d, o1.MDMA, h.id));
      await as(db, H, () => db.query(`update sessions set ended_at = '2026-10-03T10:10:00Z', duration_s = 600 where id = $1`, [S]));
      await as(db, T, () => db.query(
        `insert into corrections (id, session_id, unit_id, trainer_id, void, new_duration_s, reason)
         values (gen_random_uuid(), $1, $2, $3, false, 540, 'stopped late')`, [S, unit, t.id]));
    }
    for (const team of [TEAM, TEAM2]) {
      await as(db, T, () => db.query(
        `insert into team_odours (team_id, odour_id, unit_id, selected) values ($1, $2, $3, true)`, [team, o1.MDMA, unit]));
    }
    return c;
  }

  it('a handler is refused, even for an archived team', async () => {
    const { db } = await withHistory();
    await archive(db);
    await expect(del(db, H)).rejects.toThrow(/trainers only/);
    expect(await count(db, 'teams where id = $1', [TEAM])).toBe(1);
  });

  it('another unit’s trainer, and a team that does not exist, get the very same error', async () => {
    const { db } = await withHistory();
    await archive(db);
    await expect(del(db, X)).rejects.toThrow(/trainers only/);
    await expect(del(db, T, '99999999-0000-0000-0000-000000000000')).rejects.toThrow(/trainers only/);
    expect(await count(db, 'teams where id = $1', [TEAM])).toBe(1);
  });

  it('anon cannot call it at all', async () => {
    const { db } = await withHistory();
    await db.exec('set role anon');
    try {
      await expect(db.query(`select public.delete_team_forever('${TEAM}')`)).rejects.toThrow(/permission denied for function/);
    } finally { await db.exec('reset role'); }
  });

  it('refuses a team that is not archived', async () => {
    const { db } = await withHistory();
    await expect(del(db, T)).rejects.toThrow(/archived first/);
    expect(await count(db, 'dogs where team_id = $1', [TEAM])).toBe(2);
  });

  it('refuses while any dog of the team has a running timer', async () => {
    const { db, h, unit, o1 } = await withHistory();
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-0000000001f0', unit, DOG2, o1.Cocaine, h.id));
    // Archiving is blocked too, so archive when stopped ... then start a new timer straight from an offline phone.
    await as(db, H, () => db.query(`update sessions set ended_at = now(), duration_s = 1 where id = '20000000-0000-0000-0000-0000000001f0'`));
    await archive(db);
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-0000000001f1', unit, DOG2, o1.Cocaine, h.id, '2026-10-04T10:00:00Z'));
    await expect(del(db, T)).rejects.toThrow(/running timer/);
    expect(await count(db, 'dogs where team_id = $1', [TEAM])).toBe(2);
  });

  it('removes the team, its dogs, their sessions, corrections and odour choices, and leaves tombstones', async () => {
    const { db, t, unit } = await withHistory();
    await archive(db);
    await del(db, T);
    expect(await count(db, 'teams where id = $1', [TEAM])).toBe(0);
    expect(await count(db, 'dogs where id in ($1, $2)', [DOG, DOG2])).toBe(0);
    expect(await count(db, 'sessions where dog_id in ($1, $2)', [DOG, DOG2])).toBe(0);
    expect(await count(db, 'corrections c where not exists (select 1 from sessions s where s.id = c.session_id)')).toBe(0);
    expect(await count(db, 'team_odours where team_id = $1', [TEAM])).toBe(0);
    const dogs = (await db.query<{ dog_id: string; unit_id: string; deleted_by: string }>(
      'select dog_id, unit_id, deleted_by from deleted_dogs order by dog_id')).rows;
    expect(dogs.map((r) => r.dog_id)).toEqual([DOG, DOG2]);
    for (const r of dogs) { expect(r.unit_id).toBe(unit); expect(r.deleted_by).toBe(t.id); }
    const teams = (await db.query<{ team_id: string; unit_id: string; deleted_by: string }>('select team_id, unit_id, deleted_by from deleted_teams')).rows;
    expect(teams).toEqual([{ team_id: TEAM, unit_id: unit, deleted_by: t.id }]);
  });

  it('touches nothing else: the other team, its dog and history, the catalogue, the other unit', async () => {
    const { db } = await withHistory();
    await archive(db);
    await del(db, T);
    expect(await count(db, 'teams')).toBe(2); // TEAM2 and XTEAM
    expect(await count(db, 'dogs where id in ($1, $2)', [KEEPER, XDOG])).toBe(2);
    expect(await count(db, 'sessions where dog_id = $1', [KEEPER])).toBe(1);
    expect(await count(db, 'corrections')).toBe(1);
    expect(await count(db, 'team_odours where team_id = $1', [TEAM2])).toBe(1);
    expect(await count(db, 'odours')).toBe(40);
    expect(await count(db, 'odour_categories')).toBe(8);
  });

  it('the tombstones are readable by the unit and nobody else', async () => {
    const { db, unit } = await withHistory();
    await archive(db);
    await del(db, T);
    expect((await as(db, H, () => db.query('select team_id from deleted_teams'))).rows).toHaveLength(1);
    expect((await as(db, H, () => db.query('select dog_id from deleted_dogs'))).rows).toHaveLength(2);
    const x = await as(db, X, () => db.query<{ unit_id: string }>('select unit_id from deleted_teams'));
    expect(x.rows.filter((r) => r.unit_id === unit)).toHaveLength(0);
    expect(x.rows).toHaveLength(0);
  });
});

// ───────── anon, and the helper functions ─────────

describe('anon cannot execute any function in the public schema', () => {
  it('none at all: RPCs, RLS helpers, trigger functions, the catalogue seeder', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('the RLS helpers and the RPCs stay executable by authenticated', async () => {
    const db = await freshDb();
    const names = ['my_member_id', 'is_active_member', 'is_trainer', 'was_me_active_at', 'dog_in_unit', 'session_in_unit',
      'enter_with_link', 'choose_name', 'add_name', 'switch_name', 'get_links', 'regenerate_link', 'remove_member',
      'delete_dog_forever', 'delete_team_forever'];
    const { rows } = await db.query<{ proname: string; authed: boolean }>(`
      select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authed
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1)`, [names]);
    expect(rows.map((r) => r.proname).sort()).toEqual([...names].sort());
    for (const r of rows) expect(r.authed, r.proname).toBe(true);
  });

  it('the seeder is internal: not even a signed-in user can call it', async () => {
    const { db, unit } = await setup();
    await expect(as(db, T, () => db.query(`select public.seed_default_catalogue($1)`, [unit]))).rejects.toThrow(/permission denied for function/);
  });

  it('with the revokes in place RLS still works for authenticated, and anon reads nothing and does not error', async () => {
    const { db } = await setup();
    // The harness grants table privileges to anon, as Supabase does; RLS is what keeps it out.
    for (const table of ['units', 'members', 'teams', 'dogs', 'sessions', 'corrections', 'odour_categories', 'odours', 'team_odours', 'deleted_dogs', 'deleted_teams']) {
      await db.exec('set role anon');
      try {
        expect((await db.query(`select * from ${table}`)).rows, table).toHaveLength(0);
        await expect(db.query(`delete from ${table}`)).resolves.toBeTruthy();
      } finally { await db.exec('reset role'); }
    }
    await db.exec('set role anon');
    try {
      await expect(db.query(
        `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), gen_random_uuid(), 'Sneaky', gen_random_uuid())`,
      )).rejects.toThrow(/row-level security/);
    } finally { await db.exec('reset role'); }
    expect((await as(db, H, () => db.query('select id from teams'))).rows.length).toBeGreaterThan(0);
    expect((await as(db, T, () => db.query('select id from odours'))).rows).toHaveLength(20);
  });
});

describe('realtime', () => {
  it('publishes the new tables and the team tombstones', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`);
    const tables = rows.map((r) => r.tablename);
    for (const t of ['teams', 'odour_categories', 'odours', 'team_odours', 'deleted_teams']) expect(tables).toContain(t);
  });
});

// ───────── Upgrading a database that already holds v1 data ─────────

describe('migration 0005 on existing data', () => {
  it('moves dogs into a team and sessions onto catalogue odours, keeping every number', async () => {
    const db = await freshDb(true, '0004'); // the v1 schema
    const U = '00000000-0000-0000-0000-0000000000f1';
    await addUser(db, U);
    await as(db, U, () => db.query(`select public.create_unit('Old unit', 'Olga')`));
    const m = (await db.query<{ id: string; unit_id: string }>('select id, unit_id from members')).rows[0];
    const D1 = '10000000-0000-0000-0000-0000000000d1', D2 = '10000000-0000-0000-0000-0000000000d2';
    for (const [id, name] of [[D1, 'Rex'], [D2, 'Fly']]) {
      await db.query(`insert into dogs (id, unit_id, name, created_by) values ($1, $2, $3, $4)`, [id, m.unit_id, name, m.id]);
    }
    await db.query(`update dogs set archived_at = '2026-10-02T00:00:00Z' where id = $1`, [D2]);
    await db.query(
      `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, ended_at, duration_s)
       values ('20000000-0000-0000-0000-0000000000e1', $1, $2, 'c4-rdx', $3, 'timed', '2026-10-01', '2026-10-01T09:00:00Z', '2026-10-01T09:20:00Z', 1200),
              ('20000000-0000-0000-0000-0000000000e2', $1, $2, 'mdma', $3, 'timed', '2026-10-02', '2026-10-02T09:00:00Z', null, null)`,
      [m.unit_id, D1, m.id]);
    await db.query(
      `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, duration_s)
       values ('20000000-0000-0000-0000-0000000000e3', $1, $2, 'cannabis', $3, 'manual', '2026-10-02', 600)`, [m.unit_id, D2, m.id]);

    await applyMigrations(db, { after: '0004' });

    const dogs = (await db.query<{ name: string; team_id: string; breed: string; purpose: string; archived_at: string | null }>(
      'select name, team_id, breed, purpose, archived_at from dogs order by name')).rows;
    expect(dogs).toHaveLength(2);
    expect(new Set(dogs.map((d) => d.team_id)).size).toBe(1);
    expect(dogs.map((d) => [d.breed, d.purpose])).toEqual([['other', 'single'], ['other', 'single']]);
    expect(dogs.find((d) => d.name === 'Fly')!.archived_at).not.toBeNull(); // archive state kept
    const team = (await db.query<{ name: string; created_by: string }>('select name, created_by from teams')).rows;
    expect(team).toEqual([{ name: 'All dogs', created_by: m.id }]);
    // the team trains the whole default catalogue
    expect(await count(db, 'team_odours where selected')).toBe(20);

    const s = (await db.query<{ id: string; odour: string; duration_s: number | null; ended_at: string | null }>(
      `select s.id, o.name as odour, s.duration_s, s.ended_at from sessions s join odours o on o.id = s.odour_id order by s.id`)).rows;
    expect(s.map((r) => [r.odour, r.duration_s])).toEqual([['C4/RDX', 1200], ['MDMA', null], ['Cannabis', 600]]);
    expect(s[0].ended_at).not.toBeNull(); // a stopped session stays stopped
    expect(s[1].ended_at).toBeNull(); // a running one stays running
  });
});
