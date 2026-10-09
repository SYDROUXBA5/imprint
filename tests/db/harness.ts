import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

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
`;

const GRANTS = `
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`;

export async function freshDb(withSchema = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  if (withSchema) {
    await db.exec(readFileSync('supabase/migrations/0001_init.sql', 'utf8'));
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
