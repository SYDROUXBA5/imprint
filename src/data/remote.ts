import type { SupabaseClient } from '@supabase/supabase-js';

export interface RemoteError { code?: string; message: string }
export type PulledTable =
  | 'units' | 'members' | 'teams' | 'odour_categories' | 'odours' | 'team_odours'
  | 'dogs' | 'sessions' | 'corrections' | 'deleted_teams' | 'deleted_dogs';

export interface RemoteStore {
  /**
   * Create the row if it is not there yet (a repeat of an insert that already reached the server is a no-op).
   * `team_odours` has no id and its whole row is the state, so there a repeat overwrites `selected` instead.
   */
  insert(table: string, row: Record<string, unknown>): Promise<{ error?: RemoteError }>;
  update(table: string, id: string, patch: Record<string, unknown>): Promise<{ error?: RemoteError }>;
  changesSince(table: PulledTable, unitId: string, sinceIso: string):
    Promise<{ rows: Record<string, unknown>[]; error?: RemoteError }>;
  /**
   * Does the server still let this phone into the unit? Row Level Security answers: a phone whose link was
   * replaced, or whose name was removed, reads no rows at all, so asking for the unit's own row tells.
   * false = no; undefined = could not tell (no signal), which is never treated as "no".
   */
  hasAccess(unitId: string): Promise<boolean | undefined>;
}

const err = (e: { code?: string; message: string } | null) =>
  e ? { error: { code: e.code || undefined, message: e.message } } : {};

export const supabaseRemote = (client: SupabaseClient): RemoteStore => ({
  async insert(table, row) {
    const choice = table === 'team_odours';
    const { error } = await client.from(table).upsert(row, choice
      ? { onConflict: 'team_id,odour_id' }
      : { onConflict: 'id', ignoreDuplicates: true });
    return err(error);
  },
  async update(table, id, patch) {
    const { error } = await client.from(table).update(patch).eq('id', id);
    return err(error);
  },
  async hasAccess(unitId) {
    const { data, error } = await client.from('units').select('id').eq('id', unitId).maybeSingle();
    return error ? undefined : !!data;
  },
  async changesSince(table, unitId, sinceIso) {
    const q = client.from(table).select('*').gt('updated_at', sinceIso).order('updated_at');
    const { data, error } = await (table === 'units' ? q.eq('id', unitId) : q.eq('unit_id', unitId));
    return { rows: data ?? [], ...err(error) };
  },
});
