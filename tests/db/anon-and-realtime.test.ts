import { describe, expect, it } from 'vitest';
import { freshDb } from './harness';

// The harness mirrors Supabase's default privileges (new functions are executable by
// anon and authenticated), so each function below is only closed to anon if its
// migration says REVOKE ... FROM anon explicitly.
const RPCS = [
  `public.enter_with_link('0123456789abcdef0123456789abcdef')`,
  `public.choose_name(gen_random_uuid())`,
  `public.add_name('Paul')`,
  `public.switch_name()`,
  `public.get_links()`,
  `public.regenerate_link('handler')`,
  `public.remove_member(gen_random_uuid())`,
  `public.setup_unit('Wells K9')`,
  `public.make_unit('Wells K9')`,
  `public.live_device()`,
  `public.entered_payload(gen_random_uuid(), 'handler')`,
];

describe('anon cannot execute the link, name and unit functions', () => {
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
        and p.proname in ('enter_with_link', 'choose_name', 'add_name', 'switch_name', 'get_links', 'regenerate_link',
                          'remove_member', 'delete_dog_forever', 'delete_team_forever')`);
    expect(rows.map((r) => r.proname).sort()).toEqual([
      'add_name', 'choose_name', 'delete_dog_forever', 'delete_team_forever', 'enter_with_link', 'get_links',
      'regenerate_link', 'remove_member', 'switch_name']);
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
