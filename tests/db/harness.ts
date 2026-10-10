import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

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
  -- Supabase grants EXECUTE on every new public function to anon and authenticated
  -- (default privileges). Mirror that, so a missing REVOKE ... FROM anon shows up here.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  -- Supabase ships this publication; the realtime migrations add tables to it.
  create publication supabase_realtime;
`;

const GRANTS = `
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
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

export async function freshDb(withSchema = true, through?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  if (withSchema) {
    await applyMigrations(db, { through });
    await db.exec(GRANTS);
  }
  return db;
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
