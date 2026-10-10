import { describe, expect, it } from 'vitest';
import { freshDb } from './harness';

// The harness mirrors Supabase's default privileges (new functions are executable by
// anon and authenticated), so each function below is only closed to anon if its
// migration says REVOKE ... FROM anon explicitly.
const RPCS = [
  `public.create_unit('Wells K9', 'Tess')`,
  `public.join_unit('ABC234', 'Paul')`,
  `public.regenerate_invite_code()`,
  `public.gen_invite_code()`,
];

describe('anon cannot execute the invite/unit functions', () => {
  for (const call of RPCS) {
    it(call, async () => {
      const db = await freshDb();
      await db.exec('set role anon');
      try {
        await expect(db.query(`select ${call}`)).rejects.toThrow(/permission denied for function/);
      } finally {
        await db.exec('reset role');
      }
    });
  }

  it('the RPCs are executable by authenticated and not by anon', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ proname: string; anon: boolean; authed: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authed
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('create_unit', 'join_unit', 'regenerate_invite_code', 'delete_dog_forever', 'delete_team_forever')`);
    expect(rows.map((r) => r.proname).sort()).toEqual(['create_unit', 'delete_dog_forever', 'delete_team_forever', 'join_unit', 'regenerate_invite_code']);
    for (const r of rows) {
      expect(r.anon, `${r.proname} must not be executable by anon`).toBe(false);
      expect(r.authed, `${r.proname} must stay executable by authenticated`).toBe(true);
    }
  });
});

describe('realtime publication', () => {
  it('publishes the synced tables and the tombstones', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`);
    expect(rows.map((r) => r.tablename).sort()).toEqual([
      'corrections', 'deleted_dogs', 'deleted_teams', 'dogs', 'members', 'odour_categories', 'odours', 'sessions', 'team_odours', 'teams',
    ]);
  });
});
