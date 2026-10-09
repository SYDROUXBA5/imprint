import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { addUser, as, freshDb } from './harness';

describe('PGlite RLS spike', () => {
  it('hides rows from authenticated when no policy allows them', async () => {
    const db = await freshDb(false);
    await db.exec(`
      create table t (id int); insert into t values (1);
      alter table t enable row level security;
      grant select on t to authenticated;
    `);
    const rows = await as(db, '00000000-0000-0000-0000-000000000001', () => db.query('select * from t'));
    expect(rows.rows).toHaveLength(0);
  });
});

const T = '00000000-0000-0000-0000-0000000000a1'; // trainer user
const H = '00000000-0000-0000-0000-0000000000b1'; // handler user
const X = '00000000-0000-0000-0000-0000000000c1'; // other unit's trainer
const DOG = '10000000-0000-0000-0000-000000000001';

async function setup() {
  const db = await freshDb();
  for (const u of [T, H, X]) await addUser(db, u);
  await as(db, T, () => db.query(`select public.create_unit('Wells K9', 'Tess')`));
  const code = (await db.query<{ invite_code: string }>('select invite_code from units')).rows[0].invite_code;
  await as(db, H, () => db.query(`select public.join_unit($1, 'Paul')`, [code.toLowerCase()]));
  await as(db, X, () => db.query(`select public.create_unit('Other unit', 'Xavier')`));
  const ids = async (user: string) =>
    (await db.query<{ id: string; unit_id: string }>('select id, unit_id from members where user_id = $1', [user])).rows[0];
  const t = await ids(T), h = await ids(H), x = await ids(X);
  await as(db, T, () => db.query(
    `insert into dogs (id, unit_id, name, created_by) values ($1, $2, 'Rex', $3)`, [DOG, t.unit_id, t.id]));
  return { db, t, h, x, unit: t.unit_id };
}

const insertTimed = (db: PGlite, id: string, unit: string, handler: string, startedAt = '2026-10-03T10:00:00Z') =>
  db.query(
    `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, client_sent_at)
     values ($1, $2, $3, 'mdma', $4, 'timed', '2026-10-03', $5, now())`,
    [id, unit, DOG, handler, startedAt]);

describe('permissions', () => {
  it('invite code is 6 chars from the alphabet', async () => {
    const { db } = await setup();
    const codes = (await db.query<{ invite_code: string }>('select invite_code from units')).rows;
    for (const c of codes) expect(c.invite_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/);
  });

  it('handler cannot add a dog; trainer can', async () => {
    const { db, h, unit } = await setup();
    await expect(as(db, H, () => db.query(
      `insert into dogs (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Nope', $2)`, [unit, h.id]),
    )).rejects.toThrow(/row-level security/);
  });

  it('handler can start and stop own session, and retrying Stop is harmless', async () => {
    const { db, h, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000001';
    await as(db, H, () => insertTimed(db, S, unit, h.id));
    const stop = () => db.query(
      `update sessions set ended_at = '2026-10-03T10:12:00Z', duration_s = 720 where id = $1`, [S]);
    await as(db, H, stop);
    await as(db, H, stop);
    const row = (await db.query<{ duration_s: number; client_clock_offset_s: number }>(
      'select duration_s, client_clock_offset_s from sessions where id = $1', [S])).rows[0];
    expect(row.duration_s).toBe(720);
    expect(row.client_clock_offset_s).toBe(0);
  });

  it("handler cannot stop another handler's session", async () => {
    const { db, t, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000002';
    await as(db, T, () => insertTimed(db, S, unit, t.id));
    const res = await as(db, H, () => db.query(
      `update sessions set ended_at = now(), duration_s = 1 where id = $1`, [S]));
    expect(res.affectedRows ?? 0).toBe(0);
  });

  it('nobody can change a session other than Stop, or delete it', async () => {
    const { db, h, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000003';
    await as(db, H, () => insertTimed(db, S, unit, h.id));
    await expect(as(db, H, () => db.query(
      `update sessions set odour_id = 'tnt', ended_at = now(), duration_s = 5 where id = $1`, [S]),
    )).rejects.toThrow(/only ended_at/);
    const del = await as(db, H, () => db.query('delete from sessions where id = $1', [S]));
    expect(del.affectedRows ?? 0).toBe(0);
  });

  it('only trainers can add corrections, and a reason is required', async () => {
    const { db, t, h, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000004';
    await as(db, H, () => insertTimed(db, S, unit, h.id));
    const add = (user: string, member: string, reason: string) => as(db, user, () => db.query(
      `insert into corrections (id, session_id, unit_id, trainer_id, void, new_duration_s, reason)
       values (gen_random_uuid(), $1, $2, $3, false, 480, $4)`, [S, unit, member, reason]));
    await expect(add(H, h.id, 'nope')).rejects.toThrow(/row-level security/);
    await expect(add(T, t.id, '  ')).rejects.toThrow(/check/);
    await add(T, t.id, 'forgot to stop, real time 8 min');
  });

  it('another unit sees nothing', async () => {
    const { db, h, unit } = await setup();
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000005', unit, h.id));
    const seen = await as(db, X, () => db.query('select * from sessions'));
    expect(seen.rows).toHaveLength(0);
    const dogs = await as(db, X, () => db.query('select * from dogs'));
    expect(dogs.rows).toHaveLength(0);
  });

  it('removed handler: earlier sessions accepted, later ones rejected, no reads', async () => {
    const { db, h, unit } = await setup();
    await as(db, T, () => db.query(
      `update members set removed_at = '2026-10-03T12:00:00Z' where id = $1`, [h.id]));
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000006', unit, h.id, '2026-10-03T11:00:00Z'));
    await expect(as(db, H, () =>
      insertTimed(db, '20000000-0000-0000-0000-000000000007', unit, h.id, '2026-10-03T13:00:00Z'),
    )).rejects.toThrow(/row-level security/);
    const seen = await as(db, H, () => db.query('select * from dogs'));
    expect(seen.rows).toHaveLength(0);
  });

  it('a unit always keeps one trainer', async () => {
    const { db, t } = await setup();
    await expect(as(db, T, () => db.query(
      `update members set role = 'handler' where id = $1`, [t.id]),
    )).rejects.toThrow(/at least one trainer/);
  });

  it('archiving a dog with a running timer is blocked', async () => {
    const { db, h, unit } = await setup();
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000008', unit, h.id));
    await expect(as(db, T, () => db.query(
      `update dogs set archived_at = now() where id = $1`, [DOG]),
    )).rejects.toThrow(/running timer/);
  });

  it('wrong invite code and double join are refused', async () => {
    const { db } = await setup();
    const Y = '00000000-0000-0000-0000-0000000000d1';
    await addUser(db, Y);
    await expect(as(db, Y, () => db.query(`select public.join_unit('ZZZZZZ', 'Yan')`))).rejects.toThrow(/invalid invite code/);
    await expect(as(db, H, () => db.query(`select public.create_unit('Again', 'Paul')`))).rejects.toThrow(/already in a unit/);
  });
});
