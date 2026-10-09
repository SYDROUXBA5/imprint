import type { SupabaseClient } from '@supabase/supabase-js';

export interface RemoteError { code?: string; message: string }
export type PulledTable = 'units' | 'members' | 'dogs' | 'sessions' | 'corrections' | 'deleted_dogs';

export interface RemoteStore {
  insert(table: string, row: Record<string, unknown>): Promise<{ error?: RemoteError }>;
  update(table: string, id: string, patch: Record<string, unknown>): Promise<{ error?: RemoteError }>;
  changesSince(table: PulledTable, unitId: string, sinceIso: string):
    Promise<{ rows: Record<string, unknown>[]; error?: RemoteError }>;
}

const err = (e: { code?: string; message: string } | null) =>
  e ? { error: { code: e.code || undefined, message: e.message } } : {};

export const supabaseRemote = (client: SupabaseClient): RemoteStore => ({
  async insert(table, row) {
    const { error } = await client.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    return err(error);
  },
  async update(table, id, patch) {
    const { error } = await client.from(table).update(patch).eq('id', id);
    return err(error);
  },
  async changesSince(table, unitId, sinceIso) {
    const q = client.from(table).select('*').gt('updated_at', sinceIso).order('updated_at');
    const { data, error } = await (table === 'units' ? q.eq('id', unitId) : q.eq('unit_id', unitId));
    return { rows: data ?? [], ...err(error) };
  },
});
