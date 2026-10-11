import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyMigrations, as, createUnit, enterLink, freshDb, joinAs, type Entered, type LinkRole } from './harness';

// Spec §14: access by two secret links, no accounts. Every rule is tried from the same five angles:
// a trainer-link phone, a handler-link phone, a phone that never opened a link, the anon role,
// and a trainer of another unit.

const T = '00000000-0000-0000-0000-0000000000a1'; // trainer link, "Tess"
const T2 = '00000000-0000-0000-0000-0000000000a2'; // trainer link, "Tina"
const H = '00000000-0000-0000-0000-0000000000b1'; // handler link, "Paul"
const H2 = '00000000-0000-0000-0000-0000000000b2'; // handler link, "Hana"
const H3 = '00000000-0000-0000-0000-0000000000b3'; // handler link, also "Paul" (a second phone on the same name)
const N = '00000000-0000-0000-0000-0000000000d1'; // signed in, never opened a link
const X = '00000000-0000-0000-0000-0000000000c1'; // trainer of another unit, "Xavier"
const TEAM = '30000000-0000-0000-0000-000000000001';
const DOG = '10000000-0000-0000-0000-000000000001';
const S1 = '20000000-0000-0000-0000-000000000001'; // a session by Paul

const TABLES = ['units', 'members', 'teams', 'dogs', 'sessions', 'corrections', 'odour_categories', 'odours', 'team_odours',
  'deleted_dogs', 'deleted_teams'];

async function setup() {
  const db = await freshDb();
  const unit = await createUnit(db, 'Wells K9');
  const other = await createUnit(db, 'Other unit');
  const tess = await joinAs(db, T, unit.trainer, 'Tess');
  const tina = await joinAs(db, T2, unit.trainer, 'Tina');
  const paul = await joinAs(db, H, unit.handler, 'Paul');
  const hana = await joinAs(db, H2, unit.handler, 'Hana');
  const xavier = await joinAs(db, X, other.trainer, 'Xavier');
  await db.query('insert into auth.users (id) values ($1)', [N]);
  await as(db, T, () => db.query(`insert into teams (id, unit_id, name, created_by) values ($1, $2, 'Alpha', $3)`, [TEAM, unit.id, tess.id]));
  await as(db, T, () => db.query(
    `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose) values ($1, $2, 'Rex', $3, $4, 'malinois', 'dual')`,
    [DOG, unit.id, tess.id, TEAM]));
  const mdma = (await db.query<{ id: string }>(`select id from odours where unit_id = $1 and name = 'MDMA'`, [unit.id])).rows[0].id;
  return { db, unit, other, tess, tina, paul, hana, xavier, mdma };
}

const asAnon = async <R>(db: PGlite, fn: () => Promise<R>): Promise<R> => {
  await db.exec('set role anon');
  try { return await fn(); } finally { await db.exec('reset role'); }
};

/** How many rows of each table a phone can read. */
async function seen(db: PGlite, user: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    out[t] = Number((await as(db, user, () => db.query<{ n: number }>(`select count(*)::int as n from ${t}`))).rows[0].n);
  }
  return out;
}
const NOTHING = Object.fromEntries(TABLES.map((t) => [t, 0]));

/** Did the statement do something? An insert/update that RLS filters away reports 0 rows rather than an error. */
async function allowed(db: PGlite, user: string, sql: string, params: unknown[] = []): Promise<boolean> {
  try {
    const r = await as(db, user, () => db.query(sql, params));
    return /^\s*select/i.test(sql) ? true : (r.affectedRows ?? 0) > 0;
  } catch { return false; }
}

const startSession = (id: string, unit: string, handler: string, odour: string, at = '2026-10-03T10:00:00Z') => ({
  sql: `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, client_sent_at)
        values ($1, $2, $3, $4, $5, 'timed', '2026-10-03', $6, now())`,
  params: [id, unit, DOG, odour, handler, at],
});
const stopSql = (id: string, endedAt = '2026-10-03T10:12:00Z') => ({
  sql: `update sessions set ended_at = $2, duration_s = 720 where id = $1`, params: [id, endedAt],
});

const regenerate = async (db: PGlite, user: string, role: LinkRole) =>
  (await as(db, user, () => db.query<{ t: string }>('select public.regenerate_link($1) as t', [role]))).rows[0].t;
const links = async (db: PGlite, user: string) =>
  (await as(db, user, () => db.query<{ l: { trainer: string; handler: string } }>('select public.get_links() as l'))).rows[0].l;

// ───────── The owner sets the unit up, once ─────────

describe('setup_unit', () => {
  it('creates the unit with the default catalogue and returns one 32-hex token per link', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ role: string; token: string; path: string }>(`select * from public.setup_unit('Wells K9')`);
    expect(rows.map((r) => r.role).sort()).toEqual(['handler', 'trainer']);
    for (const r of rows) {
      expect(r.token).toMatch(/^[0-9a-f]{32}$/);
      expect(r.path).toBe(`#/${r.role}/${r.token}`);
    }
    expect(new Set(rows.map((r) => r.token)).size).toBe(2);
    expect((await db.query('select 1 from units where name = $1', ['Wells K9'])).rows).toHaveLength(1);
    expect((await db.query('select 1 from odours')).rows).toHaveLength(20);
    const stored = (await db.query<{ role: string; token: string; generation: number }>('select role, token, generation from unit_links')).rows;
    expect(stored.map((r) => [r.role, r.token, r.generation]).sort()).toEqual(
      rows.map((r) => [r.role, r.token, 1]).sort());
  });

  it('is refused while a unit exists', async () => {
    const db = await freshDb();
    await db.query(`select * from public.setup_unit('Wells K9')`);
    await expect(db.query(`select * from public.setup_unit('Again')`)).rejects.toThrow(/already exists/);
    expect((await db.query('select 1 from units')).rows).toHaveLength(1);
    expect((await db.query('select 1 from unit_links')).rows).toHaveLength(2);
  });

  it('needs a name', async () => {
    const db = await freshDb();
    await expect(db.query(`select * from public.setup_unit('   ')`)).rejects.toThrow(/needs a name/);
    expect((await db.query('select 1 from units')).rows).toHaveLength(0);
  });

  it('is not executable by anon or by a signed-in phone, and neither is the internal make_unit', async () => {
    const { db } = await setup();
    for (const call of [`public.setup_unit('Hijack')`, `public.make_unit('Hijack')`]) {
      for (const who of [T, H, N]) {
        await expect(as(db, who, () => db.query(`select * from ${call}`)), call).rejects.toThrow(/permission denied for function/);
      }
      await expect(asAnon(db, () => db.query(`select * from ${call}`)), call).rejects.toThrow(/permission denied for function/);
    }
    const { rows } = await db.query<{ proname: string; anon: boolean; authed: boolean; pub: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authed,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('setup_unit', 'make_unit')`);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect([r.anon, r.authed, r.pub], r.proname).toEqual([false, false, false]);
    expect((await db.query('select 1 from units')).rows).toHaveLength(2);
  });

  it('retires the account model: no create_unit, join_unit, invite codes, or invite_code column', async () => {
    const { db } = await setup();
    const fns = (await db.query<{ proname: string }>(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and proname in ('create_unit', 'join_unit', 'regenerate_invite_code', 'gen_invite_code')`)).rows;
    expect(fns).toEqual([]);
    const cols = (await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'units'`)).rows.map((r) => r.column_name);
    expect(cols).not.toContain('invite_code');
  });
});

// ───────── Opening a link ─────────

describe('enter_with_link', () => {
  it('shows that link’s role names only, the unit name, and no token', async () => {
    const { db, unit } = await setup();
    const t = await enterLink(db, T, unit.trainer);
    expect([t.unit_name, t.scope, t.names.map((n) => n.name)]).toEqual(['Wells K9', 'trainer', ['Tess', 'Tina']]);
    const h = await enterLink(db, H, unit.handler);
    expect([h.unit_name, h.scope, h.names.map((n) => n.name)]).toEqual(['Wells K9', 'handler', ['Hana', 'Paul']]);
    const blob = JSON.stringify([t, h]);
    expect(blob).not.toContain(unit.trainer);
    expect(blob).not.toContain(unit.handler);
  });

  it('lists names alphabetically, ignoring case, and leaves removed names out', async () => {
    const { db, unit, hana } = await setup();
    await joinAs(db, '00000000-0000-0000-0000-0000000000e1', unit.handler, 'amir');
    await joinAs(db, '00000000-0000-0000-0000-0000000000e2', unit.handler, 'Zoe');
    await as(db, T, () => db.query('select public.remove_member($1)', [hana.id]));
    const h = await enterLink(db, H, unit.handler);
    expect(h.names.map((n) => n.name)).toEqual(['amir', 'Paul', 'Zoe']);
  });

  it('refuses a wrong, empty, malformed or foreign token with one and the same error, from every kind of caller', async () => {
    const { db, unit, other } = await setup();
    const bad = ['0'.repeat(32), '', 'not-a-token', unit.trainer.toUpperCase(), ` ${unit.trainer}`, unit.trainer.slice(0, 31), "x' or '1'='1"];
    const messages = new Set<string>();
    for (const who of [T, H, N, X]) {
      for (const token of bad) {
        const err = await as(db, who, () => db.query('select public.enter_with_link($1)', [token])).then(() => null, (e: Error) => e);
        expect(err, `${who} ${token}`).not.toBeNull();
        messages.add(err!.message);
      }
    }
    expect([...messages]).toEqual(['invalid link']);
    // a token that only exists in another unit works only as that unit's link
    expect((await enterLink(db, N, other.handler)).unit_name).toBe('Other unit');
  });

  it('refuses a caller with no identity, with the same error', async () => {
    const { db, unit } = await setup();
    await db.exec('set role authenticated');
    try {
      await expect(db.query('select public.enter_with_link($1)', [unit.handler])).rejects.toThrow(/^invalid link$/);
    } finally { await db.exec('reset role'); }
  });

  it('cannot be called by anon', async () => {
    const { db, unit } = await setup();
    await expect(asAnon(db, () => db.query('select public.enter_with_link($1)', [unit.handler]))).rejects.toThrow(/permission denied for function/);
  });

  it('a phone that has opened a link but not picked a name reads and writes nothing', async () => {
    const { db, unit, tess } = await setup();
    const P = '00000000-0000-0000-0000-0000000000e3';
    await enterLink(db, P, unit.trainer);
    expect(await seen(db, P)).toEqual(NOTHING);
    expect(await allowed(db, P, `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Sneaky', $2)`, [unit.id, tess.id])).toBe(false);
    await expect(as(db, P, () => db.query('select public.get_links()'))).rejects.toThrow(/trainers only/);
  });

  it('a phone that never opened a link reads and writes nothing, and cannot pick a name or call anything', async () => {
    const { db, unit, paul, tess } = await setup();
    expect(await seen(db, N)).toEqual(NOTHING);
    const write = startSession('20000000-0000-0000-0000-0000000000a1', unit.id, paul.id, 'x');
    expect(await allowed(db, N, write.sql, write.params)).toBe(false);
    await expect(as(db, N, () => db.query('select public.choose_name($1)', [paul.id]))).rejects.toThrow(/^invalid link$/);
    await expect(as(db, N, () => db.query('select public.add_name($1)', ['Nobody']))).rejects.toThrow(/^invalid link$/);
    for (const call of ['public.get_links()', `public.regenerate_link('handler')`]) {
      await expect(as(db, N, () => db.query(`select ${call}`)), call).rejects.toThrow(/trainers only/);
    }
    await expect(as(db, N, () => db.query('select public.remove_member($1)', [tess.id]))).rejects.toThrow(/trainers only/);
    expect((await db.query('select 1 from devices where user_id = $1', [N])).rows).toHaveLength(0);
  });

  it('entering the other link changes the phone’s power and drops its name until it picks one of that list', async () => {
    const { db, unit } = await setup();
    expect((await seen(db, H)).dogs).toBe(1);
    await enterLink(db, H, unit.trainer); // a handler phone opens the trainer link
    expect(await seen(db, H)).toEqual(NOTHING); // Paul is a handler name: dropped
    const tessId = (await db.query<{ id: string }>(`select id from members where name = 'Tess'`)).rows[0].id;
    await as(db, H, () => db.query('select public.choose_name($1)', [tessId]));
    expect((await seen(db, H)).dogs).toBe(1);
    expect((await links(db, H)).trainer).toBe(unit.trainer); // the trainer link makes it a trainer, whoever it is
  });

  it('opening the same link again keeps a phone’s name', async () => {
    const { db, unit } = await setup();
    await enterLink(db, H, unit.handler);
    expect((await seen(db, H)).dogs).toBe(1);
  });
});

// ───────── Who are you? ─────────

describe('choosing and adding a name', () => {
  it('a handler-link phone cannot choose a trainer name, or any name of another unit; nothing changes', async () => {
    const { db, tess, tina, xavier } = await setup();
    for (const target of [tess, tina, xavier]) {
      await expect(as(db, H, () => db.query('select public.choose_name($1)', [target.id])), target.name).rejects.toThrow(/name not available/);
    }
    await expect(as(db, H, () => db.query('select public.choose_name($1)', ['00000000-0000-0000-0000-00000000dead']))).rejects.toThrow(/name not available/);
    const dev = (await db.query<{ member_id: string; scope: string }>('select member_id, scope from devices where user_id = $1', [H])).rows[0];
    expect(dev.scope).toBe('handler');
    expect((await db.query<{ name: string }>('select name from members where id = $1', [dev.member_id])).rows[0].name).toBe('Paul');
  });

  it('a trainer-link phone cannot choose a handler name', async () => {
    const { db, paul } = await setup();
    await expect(as(db, T, () => db.query('select public.choose_name($1)', [paul.id]))).rejects.toThrow(/name not available/);
  });

  it('a removed name cannot be chosen', async () => {
    const { db, hana } = await setup();
    await as(db, T, () => db.query('select public.remove_member($1)', [hana.id]));
    await expect(as(db, H, () => db.query('select public.choose_name($1)', [hana.id]))).rejects.toThrow(/name not available/);
  });

  it('a handler-link phone that picks any handler name is still not a trainer, whichever name it taps', async () => {
    const { db, unit, tess, paul, hana } = await setup();
    for (const name of [hana, paul]) {
      await as(db, H, () => db.query('select public.choose_name($1)', [name.id]));
      expect((await as(db, H, () => db.query<{ t: boolean }>('select public.is_trainer($1) as t', [unit.id]))).rows[0].t, name.name).toBe(false);
      expect((await as(db, H, () => db.query<{ t: boolean }>('select public.is_active_member($1) as t', [unit.id]))).rows[0].t, name.name).toBe(true);
      await expect(as(db, H, () => db.query('select public.get_links()')), name.name).rejects.toThrow(/trainers only/);
      expect(await allowed(db, H, `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose)
        values (gen_random_uuid(), $1, 'Nope', $2, $3, 'labrador', 'single')`, [unit.id, name.id, TEAM]), name.name).toBe(false);
    }
    expect((await as(db, T, () => db.query<{ t: boolean }>('select public.is_trainer($1) as t', [unit.id]))).rows[0].t).toBe(true);
    // not even by corrupting the phone's row: a device can only point at a name of its own scope and unit
    await expect(db.query('update devices set member_id = $1 where user_id = $2', [tess.id, H])).rejects.toThrow(/foreign key|violates/i);
  });

  it('a device row can never point at another unit’s name', async () => {
    const { db, xavier } = await setup();
    await expect(db.query('update devices set member_id = $1 where user_id = $2', [xavier.id, T])).rejects.toThrow(/foreign key|violates/i);
  });

  it('adds a name to the list of the link the phone used, and signs the phone in under it', async () => {
    const { db, unit } = await setup();
    const P = '00000000-0000-0000-0000-0000000000e4';
    await enterLink(db, P, unit.handler);
    const got = (await as(db, P, () => db.query<{ r: { member_id: string; name: string; scope: string; unit_id: string } }>(
      `select public.add_name('  Sam   Ng ') as r`))).rows[0].r;
    expect([got.name, got.scope, got.unit_id]).toEqual(['Sam Ng', 'handler', unit.id]);
    const m = (await db.query<{ role: string; user_id: string | null }>('select role, user_id from members where id = $1', [got.member_id])).rows[0];
    expect(m).toEqual({ role: 'handler', user_id: null });
    expect((await seen(db, P)).dogs).toBe(1);
  });

  it('adds a trainer name only from the trainer link, and never lets a handler phone add a trainer', async () => {
    const { db, unit } = await setup();
    const P = '00000000-0000-0000-0000-0000000000e5';
    await enterLink(db, P, unit.trainer);
    await as(db, P, () => db.query(`select public.add_name('Tom')`));
    expect((await db.query<{ role: string }>(`select role from members where name = 'Tom'`)).rows).toEqual([{ role: 'trainer' }]);
    await as(db, H, () => db.query(`select public.add_name('Tom')`)); // a handler named Tom is a different name in a different list
    expect((await db.query<{ role: string }>(`select role from members where name = 'Tom' order by role`)).rows).toEqual([{ role: 'handler' }, { role: 'trainer' }]);
    await expect(as(db, H, () => db.query('select public.get_links()'))).rejects.toThrow(/trainers only/);
  });

  it('names are unique per role, ignoring case and spacing, among names not removed', async () => {
    const { db, hana } = await setup();
    for (const dupe of ['paul', 'PAUL', '  Paul  ', 'Pa ul'.replace(' ', '')]) {
      await expect(as(db, H2, () => db.query('select public.add_name($1)', [dupe])), dupe).rejects.toThrow(/name taken/);
    }
    // a removed name can be added again (a new member; the old one keeps its history)
    await as(db, T, () => db.query('select public.remove_member($1)', [hana.id]));
    await as(db, H2, () => db.query(`select public.add_name('hana')`));
    expect((await db.query(`select 1 from members where lower(name) = 'hana'`)).rows).toHaveLength(2);
  });

  it('refuses an empty or very long name', async () => {
    const { db, unit } = await setup();
    const P = '00000000-0000-0000-0000-0000000000e6';
    await enterLink(db, P, unit.handler);
    for (const bad of ['', '   ', 'x'.repeat(61)]) {
      await expect(as(db, P, () => db.query('select public.add_name($1)', [bad])), bad).rejects.toThrow(/name needed/);
    }
  });

  it('switch_name signs the phone out of its name and returns the list to pick from, so no token is needed again', async () => {
    const { db, unit, paul } = await setup();
    const res = (await as(db, H, () => db.query<{ r: Entered }>('select public.switch_name() as r'))).rows[0].r;
    expect([res.unit_name, res.scope, res.names.map((n) => n.name)]).toEqual(['Wells K9', 'handler', ['Hana', 'Paul']]);
    expect(JSON.stringify(res)).not.toContain(unit.handler);
    expect(await seen(db, H)).toEqual(NOTHING); // reads nothing until a name is picked again
    await as(db, H, () => db.query('select public.choose_name($1)', [paul.id]));
    expect((await seen(db, H)).dogs).toBe(1);
  });

  it('switch_name answers a trainer-link phone with the trainer names only', async () => {
    const { db } = await setup();
    const res = (await as(db, T, () => db.query<{ r: Entered }>('select public.switch_name() as r'))).rows[0].r;
    expect([res.scope, res.names.map((n) => n.name)]).toEqual(['trainer', ['Tess', 'Tina']]);
  });

  it('switch_name is refused for a phone with no link and for a phone whose link was replaced', async () => {
    const { db } = await setup();
    await expect(as(db, N, () => db.query('select public.switch_name()'))).rejects.toThrow(/^invalid link$/);
    await regenerate(db, T, 'handler');
    await expect(as(db, H, () => db.query('select public.switch_name()'))).rejects.toThrow(/^invalid link$/);
  });
});

// ───────── What a handler-link phone can and cannot do (spec §13.5, unchanged) ─────────

describe('handler-link phone powers', () => {
  it('can choose a dog and add time: start, stop its own, add a manual session', async () => {
    const { db, unit, paul, hana, mdma } = await setup();
    const start = startSession(S1, unit.id, paul.id, mdma);
    expect(await allowed(db, H, start.sql, start.params)).toBe(true);
    const stop = stopSql(S1);
    expect(await allowed(db, H, stop.sql, stop.params)).toBe(true);
    expect(await allowed(db, H,
      `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, duration_s)
       values (gen_random_uuid(), $1, $2, $3, $4, 'manual', '2026-10-03', 600)`, [unit.id, DOG, mdma, paul.id])).toBe(true);
    // ... and cannot log time as somebody else
    const asHana = startSession('20000000-0000-0000-0000-000000000009', unit.id, hana.id, mdma);
    expect(await allowed(db, H, asHana.sql, asHana.params)).toBe(false);
  });

  it('can write nothing else: no team, dog, catalogue, correction, member or link change; a trainer-link phone can', async () => {
    const { db, unit, tess, paul, mdma } = await setup();
    const start = startSession(S1, unit.id, paul.id, mdma);
    await as(db, H, () => db.query(start.sql, start.params));
    const catId = (await db.query<{ id: string }>(`select id from odour_categories where unit_id = $1 limit 1`, [unit.id])).rows[0].id;
    const writes = (me: string): [string, string, unknown[]][] => [
      ['add a team', `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'New', $2)`, [unit.id, me]],
      ['rename a team', `update teams set name = 'Renamed' where id = $1`, [TEAM]],
      ['add a dog', `insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose)
                     values (gen_random_uuid(), $1, 'New', $2, $3, 'labrador', 'single')`, [unit.id, me, TEAM]],
      ['rename a dog', `update dogs set name = 'Renamed' where id = $1`, [DOG]],
      ['add a category', `insert into odour_categories (unit_id, name) values ($1, gen_random_uuid()::text)`, [unit.id]],
      ['rename a category', `update odour_categories set name = 'Renamed' where id = $1`, [catId]],
      ['add an odour', `insert into odours (unit_id, category_id, name) values ($1, $2, gen_random_uuid()::text)`, [unit.id, catId]],
      ['rename an odour', `update odours set name = 'Renamed' where id = $1`, [mdma]],
      ['choose a team odour', `insert into team_odours (team_id, odour_id, unit_id, selected) values ($1, $2, $3, true)
                               on conflict (team_id, odour_id) do update set selected = true`, [TEAM, mdma, unit.id]],
      ['correct a session', `insert into corrections (id, session_id, unit_id, trainer_id, void, new_duration_s, reason)
                             values (gen_random_uuid(), $1, $2, $3, false, 60, 'because')`, [S1, unit.id, me]],
      ['void a session', `insert into corrections (id, session_id, unit_id, trainer_id, void, reason)
                          values (gen_random_uuid(), $1, $2, $3, true, 'oops')`, [S1, unit.id, me]],
    ];
    for (const [label, sql, params] of writes(paul.id)) expect(await allowed(db, H, sql, params), `handler: ${label}`).toBe(false);
    for (const [label, sql, params] of writes(tess.id)) expect(await allowed(db, T, sql, params), `trainer: ${label}`).toBe(true);
  });

  it('cannot change, add or remove members or names directly, and nobody can through the API', async () => {
    const { db, unit, paul, tess } = await setup();
    for (const who of [H, T]) {
      expect(await allowed(db, who, `update members set removed_at = now() where id = $1`, [paul.id]), who).toBe(false);
      expect(await allowed(db, who, `update members set role = 'trainer' where id = $1`, [paul.id]), who).toBe(false);
      expect(await allowed(db, who, `update members set name = 'Renamed' where id = $1`, [paul.id]), who).toBe(false);
      expect(await allowed(db, who, `insert into members (unit_id, name, role) values ($1, 'Ghost', 'trainer')`, [unit.id]), who).toBe(false);
      expect(await allowed(db, who, `delete from members where id = $1`, [tess.id]), who).toBe(false);
    }
  });

  it('cannot call remove_member, regenerate_link or get_links, and cannot delete anything forever', async () => {
    const { db, tess, paul } = await setup();
    await as(db, T, () => db.query(`update dogs set archived_at = now() where id = $1`, [DOG]));
    const calls: [string, unknown[]][] = [
      ['public.get_links()', []], [`public.regenerate_link('handler')`, []], [`public.regenerate_link('trainer')`, []],
      ['public.remove_member($1)', [tess.id]], ['public.remove_member($1)', [paul.id]],
      ['public.delete_dog_forever($1)', [DOG]], ['public.delete_team_forever($1)', [TEAM]],
    ];
    for (const [call, params] of calls) {
      await expect(as(db, H, () => db.query(`select ${call}`, params)), call).rejects.toThrow(/trainers only/);
    }
    expect((await db.query('select 1 from members where removed_at is not null')).rows).toHaveLength(0);
  });

  it('cannot read the links or the device list, and neither can a trainer-link phone, nor anon', async () => {
    const { db } = await setup();
    for (const table of ['unit_links', 'devices']) {
      for (const who of [H, T, N]) {
        await expect(as(db, who, () => db.query(`select * from ${table}`)), `${who} ${table}`).rejects.toThrow(/permission denied for table/);
        await expect(as(db, who, () => db.query(`update ${table} set unit_id = unit_id`)), `${who} ${table}`).rejects.toThrow(/permission denied for table/);
      }
      await expect(asAnon(db, () => db.query(`select * from ${table}`)), table).rejects.toThrow(/permission denied for table/);
      const { rows } = await db.query<{ rls: boolean; a: boolean; r: boolean }>(`
        select relrowsecurity as rls, has_table_privilege('anon', c.oid, 'select') as a, has_table_privilege('authenticated', c.oid, 'select') as r
        from pg_class c where c.oid = $1::regclass`, [`public.${table}`]);
      expect(rows[0]).toEqual({ rls: true, a: false, r: false });
    }
  });
});

// ───────── Trainer-link phones: the links ─────────

describe('get_links', () => {
  it('shows a trainer-link phone both tokens, exactly as set up', async () => {
    const { db, unit } = await setup();
    expect(await links(db, T)).toEqual({ trainer: unit.trainer, handler: unit.handler });
  });

  it('shows another unit’s trainer only that unit’s tokens', async () => {
    const { db, other, unit } = await setup();
    const l = await links(db, X);
    expect(l).toEqual({ trainer: other.trainer, handler: other.handler });
    expect(JSON.stringify(l)).not.toContain(unit.trainer);
  });
});

describe('regenerate_link', () => {
  it('handler: old handler phones read nothing and their writes are refused; trainer phones are unaffected', async () => {
    const { db, unit, paul, mdma } = await setup();
    const start = startSession(S1, unit.id, paul.id, mdma);
    await as(db, H, () => db.query(start.sql, start.params)); // running
    const fresh = await regenerate(db, T, 'handler');
    expect(fresh).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh).not.toBe(unit.handler);

    for (const who of [H, H2]) expect(await seen(db, who), who).toEqual(NOTHING);
    const late = startSession('20000000-0000-0000-0000-000000000002', unit.id, paul.id, mdma, '2026-10-03T11:00:00Z');
    expect(await allowed(db, H, late.sql, late.params)).toBe(false);
    const stop = stopSql(S1);
    expect(await allowed(db, H, stop.sql, stop.params)).toBe(false);
    await expect(as(db, H, () => db.query('select public.choose_name($1)', [paul.id]))).rejects.toThrow(/^invalid link$/);
    await expect(as(db, H, () => db.query('select public.add_name($1)', ['Late']))).rejects.toThrow(/^invalid link$/);

    for (const who of [T, T2]) expect((await seen(db, who)).dogs, who).toBe(1);
    expect(await links(db, T)).toEqual({ trainer: unit.trainer, handler: fresh });
    expect(await allowed(db, T2, `update dogs set name = 'Rex' where id = $1`, [DOG])).toBe(true);
  });

  it('handler: the old link is dead, the new one lets the same phone back in, with its unsent work', async () => {
    const { db, unit, paul, mdma } = await setup();
    const fresh = await regenerate(db, T, 'handler');
    await expect(enterLink(db, N, unit.handler)).rejects.toThrow(/^invalid link$/);
    await expect(enterLink(db, H, unit.handler)).rejects.toThrow(/^invalid link$/);

    const late = startSession(S1, unit.id, paul.id, mdma);
    expect(await allowed(db, H, late.sql, late.params)).toBe(false); // refused while stale
    const entered = await enterLink(db, H, fresh);
    expect(entered.scope).toBe('handler');
    await as(db, H, () => db.query('select public.choose_name($1)', [paul.id]));
    expect(await allowed(db, H, late.sql, late.params)).toBe(true); // the same work now goes through
  });

  it('trainer: the calling phone keeps its access, other trainer phones lose it, handler phones are unaffected', async () => {
    const { db, unit, tess } = await setup();
    const fresh = await regenerate(db, T, 'trainer');
    expect(fresh).not.toBe(unit.trainer);

    expect((await seen(db, T)).dogs).toBe(1);
    expect(await links(db, T)).toEqual({ trainer: fresh, handler: unit.handler });
    expect(await allowed(db, T, `update dogs set name = 'Rex2' where id = $1`, [DOG])).toBe(true);

    expect(await seen(db, T2)).toEqual(NOTHING);
    await expect(as(db, T2, () => db.query('select public.get_links()'))).rejects.toThrow(/trainers only/);
    await expect(as(db, T2, () => db.query(`select public.regenerate_link('handler')`))).rejects.toThrow(/trainers only/);
    expect(await allowed(db, T2, `update dogs set name = 'Stale' where id = $1`, [DOG])).toBe(false);
    expect(await allowed(db, T2, `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Late', $2)`, [unit.id, tess.id])).toBe(false);

    for (const who of [H, H2]) expect((await seen(db, who)).dogs, who).toBe(1);
    expect((await db.query<{ name: string }>('select name from dogs')).rows[0].name).toBe('Rex2');
  });

  it('trainer: the old trainer link is dead; the new one brings another trainer phone back', async () => {
    const { db, unit, tina } = await setup();
    const fresh = await regenerate(db, T, 'trainer');
    await expect(enterLink(db, N, unit.trainer)).rejects.toThrow(/^invalid link$/);
    await enterLink(db, T2, fresh);
    await as(db, T2, () => db.query('select public.choose_name($1)', [tina.id]));
    expect(await links(db, T2)).toEqual({ trainer: fresh, handler: unit.handler });
  });

  it('can be repeated, and each new link kills the previous one', async () => {
    const { db } = await setup();
    const a = await regenerate(db, T, 'handler');
    const b = await regenerate(db, T, 'handler');
    expect(new Set([a, b]).size).toBe(2);
    await expect(enterLink(db, N, a)).rejects.toThrow(/^invalid link$/);
    expect((await enterLink(db, N, b)).scope).toBe('handler');
  });

  it('only knows the two roles', async () => {
    const { db, unit } = await setup();
    await expect(as(db, T, () => db.query(`select public.regenerate_link('admin')`))).rejects.toThrow(/unknown link/);
    expect(await links(db, T)).toEqual({ trainer: unit.trainer, handler: unit.handler });
  });

  it('never touches another unit’s links', async () => {
    const { db, other } = await setup();
    await regenerate(db, T, 'handler');
    await regenerate(db, T, 'trainer');
    expect(await links(db, X)).toEqual({ trainer: other.trainer, handler: other.handler });
    expect((await seen(db, X)).teams).toBe(0);
    expect((await enterLink(db, N, other.handler)).unit_name).toBe('Other unit');
  });
});

// ───────── Removing a name ─────────

describe('remove_member', () => {
  it('every phone on a removed name loses access; history keeps the name; the phone can pick another name', async () => {
    const { db, unit, paul, hana, mdma } = await setup();
    await joinAs(db, H3, unit.handler, 'Paul'); // a second phone on Paul
    const start = startSession(S1, unit.id, paul.id, mdma);
    await as(db, H, () => db.query(start.sql, start.params));
    await as(db, T, () => db.query('select public.remove_member($1)', [paul.id]));

    for (const who of [H, H3]) expect(await seen(db, who), who).toEqual(NOTHING);
    const later = startSession('20000000-0000-0000-0000-000000000003', unit.id, paul.id, mdma, new Date(Date.now() + 3_600_000).toISOString());
    expect(await allowed(db, H, later.sql, later.params)).toBe(false);
    expect((await seen(db, H2)).dogs).toBe(1); // other names are untouched
    expect((await seen(db, T)).sessions).toBe(1); // the history is still there, for the trainers
    expect((await db.query<{ name: string; removed_at: string | null }>(`select name, removed_at from members where id = $1`, [paul.id])).rows[0].removed_at).not.toBeNull();
    expect((await enterLink(db, H, unit.handler)).names.map((n) => n.name)).toEqual(['Hana']);

    await as(db, H, () => db.query('select public.choose_name($1)', [hana.id])); // picks another name
    expect((await seen(db, H)).dogs).toBe(1);
    expect(await seen(db, H3)).toEqual(NOTHING);
  });

  it('earlier sessions of a removed name are still accepted, later ones are not', async () => {
    const { db, unit, paul, mdma } = await setup();
    await as(db, T, () => db.query(`update dogs set name = name where id = $1`, [DOG]));
    await db.query(`update members set removed_at = '2026-10-03T12:00:00Z' where id = $1`, [paul.id]);
    const before = startSession('20000000-0000-0000-0000-000000000006', unit.id, paul.id, mdma, '2026-10-03T11:00:00Z');
    // the phone lost read access when the name was removed, but offline work done before that is not thrown away
    expect(await allowed(db, H, before.sql, before.params)).toBe(true);
    const after = startSession('20000000-0000-0000-0000-000000000007', unit.id, paul.id, mdma, '2026-10-03T13:00:00Z');
    expect(await allowed(db, H, after.sql, after.params)).toBe(false);
  });

  it('is for trainers; another unit’s trainer cannot touch this unit’s names and learns nothing about them', async () => {
    const { db, paul } = await setup();
    await expect(as(db, X, () => db.query('select public.remove_member($1)', [paul.id]))).rejects.toThrow(/no such member/);
    await expect(as(db, X, () => db.query('select public.remove_member($1)', ['00000000-0000-0000-0000-00000000dead']))).rejects.toThrow(/no such member/);
    expect((await db.query('select 1 from members where removed_at is not null')).rows).toHaveLength(0);
  });

  it('a unit always keeps one trainer name', async () => {
    const { db, tess, tina } = await setup();
    await as(db, T, () => db.query('select public.remove_member($1)', [tina.id]));
    await expect(as(db, T, () => db.query('select public.remove_member($1)', [tess.id]))).rejects.toThrow(/at least one trainer/);
    expect((await seen(db, T)).dogs).toBe(1);
  });

  it('removing twice is harmless', async () => {
    const { db, hana } = await setup();
    await as(db, T, () => db.query('select public.remove_member($1)', [hana.id]));
    await as(db, T, () => db.query('select public.remove_member($1)', [hana.id]));
    expect((await db.query('select 1 from members where removed_at is not null')).rows).toHaveLength(1);
  });
});

// ───────── Two phones on one name ─────────

describe('two phones on the same name', () => {
  it('both work, and either can stop the member’s running session; another name cannot', async () => {
    const { db, unit, paul, mdma } = await setup();
    await joinAs(db, H3, unit.handler, 'Paul');
    expect((await seen(db, H3)).dogs).toBe(1);
    const start = startSession(S1, unit.id, paul.id, mdma);
    await as(db, H, () => db.query(start.sql, start.params));
    const stop = stopSql(S1);
    expect(await allowed(db, H2, stop.sql, stop.params)).toBe(false); // Hana is someone else
    expect(await allowed(db, H3, stop.sql, stop.params)).toBe(true); // Paul's other phone stops it
    expect((await db.query<{ duration_s: number }>('select duration_s from sessions where id = $1', [S1])).rows[0].duration_s).toBe(720);
    // and the other direction
    const second = startSession('20000000-0000-0000-0000-000000000004', unit.id, paul.id, mdma, '2026-10-03T12:00:00Z');
    await as(db, H3, () => db.query(second.sql, second.params));
    const stop2 = stopSql('20000000-0000-0000-0000-000000000004', '2026-10-03T12:12:00Z');
    expect(await allowed(db, H, stop2.sql, stop2.params)).toBe(true);
  });
});

// ───────── Other units, and what is exposed ─────────

describe('isolation and exposure', () => {
  it('another unit’s phones, and phones with no link, see nothing of this unit', async () => {
    const { db, unit, paul, mdma } = await setup();
    const start = startSession(S1, unit.id, paul.id, mdma);
    await as(db, H, () => db.query(start.sql, start.params));
    expect(await seen(db, N)).toEqual(NOTHING);
    const x = await seen(db, X);
    expect([x.dogs, x.sessions, x.teams, x.corrections]).toEqual([0, 0, 0, 0]);
    expect(x.units).toBe(1);
    expect((await as(db, X, () => db.query<{ name: string }>('select name from units'))).rows).toEqual([{ name: 'Other unit' }]);
    await expect(as(db, X, () => db.query('select public.choose_name($1)', [paul.id]))).rejects.toThrow(/name not available/);
  });

  it('no function in public is executable by anon, or by PUBLIC', async () => {
    const { db } = await setup();
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute')
        or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('exactly the intended functions are executable by a signed-in phone', async () => {
    const { db } = await setup();
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([
      // what the app calls
      'add_name', 'choose_name', 'delete_dog_forever', 'delete_team_forever', 'enter_with_link', 'get_links',
      'regenerate_link', 'remove_member', 'switch_name',
      // evaluated inside the Row Level Security policies, as the signed-in phone
      'dog_in_unit', 'is_active_member', 'is_trainer', 'my_member_id', 'session_in_unit', 'was_me_active_at',
    ].sort());
  });

  it('the links and devices are not pushed over Realtime', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`);
    expect(rows.map((r) => r.tablename)).not.toContain('unit_links');
    expect(rows.map((r) => r.tablename)).not.toContain('devices');
  });

  it('anon reads nothing and writes nothing anywhere', async () => {
    const { db, unit, tess } = await setup();
    for (const t of TABLES) {
      expect((await asAnon(db, () => db.query(`select * from ${t}`))).rows, t).toHaveLength(0);
    }
    await expect(asAnon(db, () => db.query(
      `insert into teams (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Sneaky', $2)`, [unit.id, tess.id]),
    )).rejects.toThrow(/row-level security/);
  });
});

// ───────── Upgrading a database that already holds accounts ─────────

describe('migration 0007 on existing data', () => {
  it('keeps the unit, its names and its history, gives the unit its two links, and drops invite codes', async () => {
    const db = await freshDb(true, '0006');
    const U1 = '00000000-0000-0000-0000-0000000000f1', U2 = '00000000-0000-0000-0000-0000000000f2', U3 = '00000000-0000-0000-0000-0000000000f3';
    for (const u of [U1, U2, U3]) await db.query('insert into auth.users (id) values ($1)', [u]);
    await as(db, U1, () => db.query(`select public.create_unit('Old unit', 'Olga')`));
    const code = (await db.query<{ invite_code: string }>('select invite_code from units')).rows[0].invite_code;
    await as(db, U2, () => db.query(`select public.join_unit($1, 'Paul')`, [code]));
    await as(db, U3, () => db.query(`select public.join_unit($1, 'paul')`, [code])); // a namesake: the new unique names would collide
    const olga = (await db.query<{ id: string; unit_id: string }>(`select id, unit_id from members where name = 'Olga'`)).rows[0];
    const paulId = (await db.query<{ id: string }>(`select id from members where name = 'Paul'`)).rows[0].id;
    const team = '30000000-0000-0000-0000-0000000000f1', dog = '10000000-0000-0000-0000-0000000000f1';
    await db.query(`insert into teams (id, unit_id, name, created_by) values ($1, $2, 'Old team', $3)`, [team, olga.unit_id, olga.id]);
    await db.query(`insert into dogs (id, unit_id, name, created_by, team_id, breed, purpose) values ($1, $2, 'Rex', $3, $4, 'other', 'single')`, [dog, olga.unit_id, olga.id, team]);
    const odour = (await db.query<{ id: string }>(`select id from odours where name = 'MDMA'`)).rows[0].id;
    await db.query(
      `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, ended_at, duration_s)
       values ('20000000-0000-0000-0000-0000000000f1', $1, $2, $3, $4, 'timed', '2026-10-01', '2026-10-01T09:00:00Z', '2026-10-01T09:20:00Z', 1200)`,
      [olga.unit_id, dog, odour, paulId]);

    await applyMigrations(db, { after: '0006' });

    const links = (await db.query<{ role: string; token: string; generation: number }>('select role, token, generation from unit_links order by role')).rows;
    expect(links.map((l) => [l.role, l.generation])).toEqual([['handler', 1], ['trainer', 1]]);
    for (const l of links) expect(l.token).toMatch(/^[0-9a-f]{32}$/);
    const t = await enterLink(db, '00000000-0000-0000-0000-0000000000f9', links.find((l) => l.role === 'trainer')!.token);
    expect(t.names.map((n) => n.name)).toEqual(['Olga']);
    const h = await enterLink(db, '00000000-0000-0000-0000-0000000000f9', links.find((l) => l.role === 'handler')!.token);
    expect(h.names.map((n) => n.name)).toEqual(['Paul', 'paul (2)']);
    expect((await db.query<{ n: number }>('select count(*)::int as n from members where user_id is not null')).rows[0].n).toBe(0);
    expect((await db.query('select 1 from dogs')).rows).toHaveLength(1);
    expect((await db.query<{ duration_s: number }>('select duration_s from sessions')).rows).toEqual([{ duration_s: 1200 }]);
    expect((await db.query('select 1 from information_schema.columns where table_name = $1 and column_name = $2', ['units', 'invite_code'])).rows).toHaveLength(0);
    // the old accounts have no power: access is by link now
    expect(await seen(db, U1)).toEqual(NOTHING);
  });
});
