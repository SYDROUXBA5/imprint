import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { as, createUnit, freshDb, joinAs } from './harness';

const T = '00000000-0000-0000-0000-0000000000a1'; // trainer, unit 1
const H = '00000000-0000-0000-0000-0000000000b1'; // handler, unit 1
const X = '00000000-0000-0000-0000-0000000000c1'; // trainer, unit 2
const DOG = '10000000-0000-0000-0000-000000000001'; // unit 1, to be deleted
const OTHER_DOG = '10000000-0000-0000-0000-000000000002'; // unit 1, must survive
const X_DOG = '10000000-0000-0000-0000-000000000003'; // unit 2, must survive
const TEAM = '30000000-0000-0000-0000-000000000001'; // unit 1
const X_TEAM = '30000000-0000-0000-0000-000000000002'; // unit 2

async function setup() {
  const db = await freshDb();
  const links = await createUnit(db, 'Wells K9');
  const otherLinks = await createUnit(db, 'Other unit');
  const t = await joinAs(db, T, links.trainer, 'Tess');
  const h = await joinAs(db, H, links.handler, 'Paul');
  const x = await joinAs(db, X, otherLinks.trainer, 'Xavier');
  await as(db, T, () => db.query(
    `insert into teams (id, unit_id, name, created_by) values ($1, $2, 'Alpha', $3)`, [TEAM, t.unit_id, t.id]));
  await as(db, X, () => db.query(
    `insert into teams (id, unit_id, name, created_by) values ($1, $2, 'Xray', $3)`, [X_TEAM, x.unit_id, x.id]));
  const addDog = (user: string, id: string, name: string, m: { id: string; unit_id: string }, team: string) => as(db, user, () => db.query(
    `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose) values ($1, $2, $3, $4, $5, 'labrador', 'single')`,
    [id, m.unit_id, name, m.id, team]));
  await addDog(T, DOG, 'Rex', t, TEAM);
  await addDog(T, OTHER_DOG, 'Fly', t, TEAM);
  await addDog(X, X_DOG, 'Ace', x, X_TEAM);
  const mdma = (await db.query<{ id: string }>(`select id from odours where unit_id = $1 and name = 'MDMA'`, [t.unit_id])).rows[0].id;
  return { db, t, h, x, links, unit: t.unit_id, xUnit: x.unit_id, mdma };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/** A stopped timed session by the handler, plus a trainer correction on it. */
async function addHistory(c: Ctx, dog: string, sessionId: string) {
  const { db, t, h, unit, mdma } = c;
  await as(db, H, () => db.query(
    `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, client_sent_at)
     values ($1, $2, $3, $4, $5, 'timed', '2026-10-03', '2026-10-03T10:00:00Z', now())`,
    [sessionId, unit, dog, mdma, h.id]));
  await as(db, H, () => db.query(
    `update sessions set ended_at = '2026-10-03T10:10:00Z', duration_s = 600 where id = $1`, [sessionId]));
  await as(db, T, () => db.query(
    `insert into corrections (id, session_id, unit_id, trainer_id, void, new_duration_s, reason)
     values (gen_random_uuid(), $1, $2, $3, false, 540, 'stopped late')`, [sessionId, unit, t.id]));
}

const archive = (db: PGlite, dog = DOG) =>
  as(db, T, () => db.query(`update dogs set archived_at = now() where id = $1`, [dog]));

const del = (db: PGlite, user: string, dog = DOG) =>
  as(db, user, () => db.query(`select public.delete_dog_forever($1)`, [dog]));

const count = async (db: PGlite, sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0].n);

describe('delete dog forever', () => {
  it('a handler is refused, even for an archived dog', async () => {
    const { db } = await setup();
    await archive(db);
    await expect(del(db, H)).rejects.toThrow(/trainers only/);
    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(1);
  });

  it("a trainer of another unit is refused, and learns nothing about the dog", async () => {
    const { db } = await setup();
    await archive(db);
    await expect(del(db, X)).rejects.toThrow(/trainers only/);
    await expect(del(db, X, '10000000-0000-0000-0000-0000000000ff')).rejects.toThrow(/trainers only/);
    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(1);
  });

  it('a signed-out caller and the anon role are refused', async () => {
    const { db } = await setup();
    await archive(db);
    await expect(del(db, '')).rejects.toThrow(/trainers only/);
    await db.exec('set role anon');
    try {
      await expect(db.query(`select public.delete_dog_forever($1)`, [DOG])).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('reset role');
    }
    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(1);
  });

  it('a removed trainer is refused', async () => {
    const { db, links } = await setup();
    await archive(db);
    const T2 = '00000000-0000-0000-0000-0000000000a2';
    const tina = await joinAs(db, T2, links.trainer, 'Tina'); // a second trainer phone ...
    await as(db, T, () => db.query('select public.remove_member($1)', [tina.id])); // ... and her name is removed
    await expect(del(db, T2)).rejects.toThrow(/trainers only/);
    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(1);
  });

  it('a phone whose trainer link was replaced is refused', async () => {
    const { db, links } = await setup();
    await archive(db);
    const T2 = '00000000-0000-0000-0000-0000000000a2';
    await joinAs(db, T2, links.trainer, 'Tina');
    await as(db, T, () => db.query(`select public.regenerate_link('trainer')`)); // Tess keeps access, Tina does not
    await expect(del(db, T2)).rejects.toThrow(/trainers only/);
    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(1);
  });

  it('a dog that is not archived is refused', async () => {
    const { db } = await setup();
    await expect(del(db, T)).rejects.toThrow(/archived/);
    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(1);
  });

  it('a dog with a running session is refused, and nothing is deleted', async () => {
    const c = await setup();
    const { db, h, unit, mdma } = c;
    await addHistory(c, DOG, '20000000-0000-0000-0000-000000000001');
    await archive(db);
    // A session started on the archived dog (e.g. offline, synced late) and never stopped.
    await as(db, H, () => db.query(
      `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, client_sent_at)
       values ('20000000-0000-0000-0000-000000000002', $1, $2, $4, $3, 'timed', '2026-10-04', '2026-10-04T09:00:00Z', now())`,
      [unit, DOG, h.id, mdma]));
    await expect(del(db, T)).rejects.toThrow(/running/);
    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(1);
    expect(await count(db, 'sessions where dog_id = $1', [DOG])).toBe(2);
    expect(await count(db, 'corrections')).toBe(1);
    expect(await count(db, 'deleted_dogs')).toBe(0);
  });

  it('a trainer deletes an archived dog, its sessions and corrections, and leaves a tombstone', async () => {
    const c = await setup();
    const { db, t, unit } = c;
    await addHistory(c, DOG, '20000000-0000-0000-0000-000000000001');
    await addHistory(c, DOG, '20000000-0000-0000-0000-000000000002');
    await addHistory(c, OTHER_DOG, '20000000-0000-0000-0000-000000000003');
    await archive(db);

    await del(db, T);

    expect(await count(db, 'dogs where id = $1', [DOG])).toBe(0);
    expect(await count(db, 'sessions where dog_id = $1', [DOG])).toBe(0);
    expect(await count(db, 'corrections where session_id in ($1, $2)', [
      '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'])).toBe(0);
    // Other dogs, in this unit and in another, are untouched.
    expect(await count(db, 'dogs where id = $1', [OTHER_DOG])).toBe(1);
    expect(await count(db, 'sessions where dog_id = $1', [OTHER_DOG])).toBe(1);
    expect(await count(db, 'corrections where session_id = $1', ['20000000-0000-0000-0000-000000000003'])).toBe(1);
    expect(await count(db, 'dogs where id = $1', [X_DOG])).toBe(1);

    const tomb = (await db.query<{ dog_id: string; unit_id: string; deleted_by: string }>(
      'select dog_id, unit_id, deleted_by from deleted_dogs')).rows;
    expect(tomb).toEqual([{ dog_id: DOG, unit_id: unit, deleted_by: t.id }]);

    // Members of the unit can read the tombstone; another unit cannot.
    const byHandler = await as(db, H, () => db.query('select dog_id from deleted_dogs'));
    expect(byHandler.rows).toEqual([{ dog_id: DOG }]);
    const byOther = await as(db, X, () => db.query('select dog_id from deleted_dogs'));
    expect(byOther.rows).toHaveLength(0);
  });

  it('deleting twice is refused (the dog is gone)', async () => {
    const { db } = await setup();
    await archive(db);
    await del(db, T);
    await expect(del(db, T)).rejects.toThrow(/trainers only/);
    expect(await count(db, 'deleted_dogs')).toBe(1);
  });

  it('the API still cannot delete dogs, sessions, corrections or tombstones directly', async () => {
    const c = await setup();
    const { db } = c;
    await addHistory(c, DOG, '20000000-0000-0000-0000-000000000001');
    await archive(db);
    await del(db, T); // creates a tombstone to try to remove
    await addHistory(c, OTHER_DOG, '20000000-0000-0000-0000-000000000003');
    await archive(db, OTHER_DOG);
    for (const table of ['dogs', 'sessions', 'corrections', 'deleted_dogs']) {
      const before = await count(db, table);
      const res = await as(db, T, () => db.query(`delete from ${table}`));
      expect(res.affectedRows ?? 0, `delete from ${table}`).toBe(0);
      expect(await count(db, table)).toBe(before);
    }
  });

  it('tombstones cannot be forged or edited through the API', async () => {
    const { db, t, unit } = await setup();
    await expect(as(db, T, () => db.query(
      `insert into deleted_dogs (dog_id, unit_id, deleted_by) values ($1, $2, $3)`, [OTHER_DOG, unit, t.id]),
    )).rejects.toThrow(/row-level security/);
    await archive(db);
    await del(db, T);
    const upd = await as(db, T, () => db.query(`update deleted_dogs set deleted_by = $1`, [t.id]));
    expect(upd.affectedRows ?? 0).toBe(0);
  });

  it('a trainer can restore an archived dog; a handler cannot', async () => {
    const { db } = await setup();
    await archive(db);
    const byHandler = await as(db, H, () => db.query(`update dogs set archived_at = null where id = $1`, [DOG]));
    expect(byHandler.affectedRows ?? 0).toBe(0);
    expect(await count(db, 'dogs where id = $1 and archived_at is not null', [DOG])).toBe(1);
    await as(db, T, () => db.query(`update dogs set archived_at = null where id = $1`, [DOG]));
    expect(await count(db, 'dogs where id = $1 and archived_at is null', [DOG])).toBe(1);
    // A restored dog is no longer deletable.
    await expect(del(db, T)).rejects.toThrow(/archived/);
  });
});
