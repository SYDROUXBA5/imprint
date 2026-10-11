import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll } from 'vitest';

const AUTH_STUB = `
  create role authenticated nologin;
  create role anon nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  -- Supabase also grants table privileges on every new public table to anon and authenticated (RLS is what
  -- keeps them out). Mirror that, so a missing REVOKE on a table the API must never touch shows up here too.
  grant usage on schema public to authenticated, anon;
  alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, anon;
  -- Supabase grants EXECUTE on every new public function to anon and authenticated
  -- (default privileges). Mirror that, so a missing REVOKE ... FROM anon shows up here.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  -- Supabase ships this publication; the realtime migrations add tables to it.
  create publication supabase_realtime;
`;

/**
 * Run the migrations in order (the realtime ones too, against the stub publication above).
 * `through` / `after` are 4-digit numbers like '0004': stop there, or start after it.
 */
export async function applyMigrations(db: PGlite, range: { through?: string; after?: string } = {}): Promise<void> {
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const n = f.slice(0, 4);
    if ((range.after && n <= range.after) || (range.through && n > range.through)) continue;
    await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }
}

/**
 * Booting Postgres and running every migration is the slow part of each test, so it is done once per
 * (schema, through) in a test file and each test starts from a copy of that data directory.
 */
const templates = new Map<string, Promise<File | Blob>>();

async function build(withSchema: boolean, through?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  if (withSchema) await applyMigrations(db, { through });
  return db;
}

function template(withSchema: boolean, through?: string): Promise<File | Blob> {
  const key = `${withSchema}:${through ?? ''}`;
  let t = templates.get(key);
  if (!t) {
    t = (async () => {
      const db = await build(withSchema, through);
      const dump = await db.dumpDataDir('none');
      await db.close();
      return dump;
    })();
    templates.set(key, t);
  }
  return t;
}

// The first copy is the slow one: build it before the first test's clock starts (a loaded machine needs a while).
beforeAll(() => template(true).then(() => undefined), 180_000);

export async function freshDb(withSchema = true, through?: string): Promise<PGlite> {
  return new PGlite({ loadDataDir: await template(withSchema, through) });
}

export async function addUser(db: PGlite, id: string): Promise<void> {
  await db.query('insert into auth.users (id) values ($1)', [id]);
}

/** Run fn as a signed-in user, with RLS applied. */
export async function as<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

// ───────── Link access (spec §14) ─────────

export type LinkRole = 'trainer' | 'handler';
export interface TestUnit { id: string; name: string; trainer: string; handler: string }
export interface Person { id: string; unit_id: string; name: string; role: LinkRole }
export interface Entered { unit_id: string; unit_name: string; scope: LinkRole; names: { id: string; name: string }[] }

/**
 * Create a unit the way the owner does, as the database owner (never through the API roles). The first unit
 * goes through setup_unit, the call the README tells the owner to make once; any further unit, for the
 * cross-unit tests, through the internal make_unit that setup_unit itself uses.
 */
export async function createUnit(db: PGlite, name: string): Promise<TestUnit> {
  const first = Number((await db.query<{ n: number }>('select count(*)::int as n from units')).rows[0].n) === 0;
  const { rows } = await db.query<{ role: LinkRole; token: string }>(
    `select role, token from public.${first ? 'setup_unit' : 'make_unit'}($1)`, [name]);
  const id = (await db.query<{ id: string }>('select id from units where name = $1', [name])).rows[0].id;
  const token = (role: LinkRole) => rows.find((r) => r.role === role)!.token;
  return { id, name, trainer: token('trainer'), handler: token('handler') };
}

/** A phone opens a link. Supabase's anonymous sign-in is simulated by an auth.users row for the phone. */
export async function enterLink(db: PGlite, user: string, token: string): Promise<Entered> {
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [user]);
  return (await as(db, user, () => db.query<{ r: Entered }>('select public.enter_with_link($1) as r', [token]))).rows[0].r;
}

/** A phone that opened a link and then tapped its name, or added it when it was not on the list yet. */
export async function joinAs(db: PGlite, user: string, token: string, name: string): Promise<Person> {
  const entered = await enterLink(db, user, token);
  const known = entered.names.find((n) => n.name.toLowerCase() === name.toLowerCase());
  const res = await as(db, user, () => known
    ? db.query<{ r: Chosen }>('select public.choose_name($1) as r', [known.id])
    : db.query<{ r: Chosen }>('select public.add_name($1) as r', [name]));
  const c = res.rows[0].r;
  return { id: c.member_id, unit_id: c.unit_id, name: c.name, role: c.scope };
}
interface Chosen { unit_id: string; scope: LinkRole; member_id: string; name: string }
