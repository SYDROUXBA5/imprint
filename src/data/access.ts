import type { Me, Role } from '../domain/types';
import { ACCESS_KEY, ME_KEY, db as appDb, type ImprintDB, type MeRecord } from './db';

// Where this phone stands, read from the local database alone: opening the app needs no network.

/** Where this phone stands. `pick`: entered, no name yet. `lost`: the server stopped letting it in. */
export type Access =
  | { kind: 'none' }
  | { kind: 'lost' }
  | { kind: 'pick'; unit_id: string; scope: Role }
  | { kind: 'in'; me: Me };

const isRole = (v: unknown): v is Role => v === 'trainer' || v === 'handler';

/** The stored record, or null for anything else (a record the old sign-in version left behind is not an entry). */
export function asMeRecord(v: unknown): MeRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const named = r.member_id === null || typeof r.member_id === 'string';
  return typeof r.unit_id === 'string' && isRole(r.scope) && 'member_id' in r && named
    ? { unit_id: r.unit_id, scope: r.scope, member_id: r.member_id as string | null }
    : null;
}

export function readAccess(db: ImprintDB = appDb): Promise<Access> {
  // One read transaction: the record, the lost flag and the name are a consistent snapshot, and it is quick.
  return db.transaction('r', db.meta, db.members, async (): Promise<Access> => {
    const rec = asMeRecord((await db.meta.get(ME_KEY))?.value);
    if (!rec) return { kind: 'none' };
    if ((await db.meta.get(ACCESS_KEY))?.value === 'lost') return { kind: 'lost' };
    if (rec.member_id === null) return { kind: 'pick', unit_id: rec.unit_id, scope: rec.scope };
    const member = await db.members.get(rec.member_id);
    return { kind: 'in', me: { id: rec.member_id, unit_id: rec.unit_id, role: rec.scope, name: member?.name ?? '' } };
  });
}

/** The server stopped letting this phone in. Everything unsent stays on the phone. */
export async function markLost(db: ImprintDB = appDb): Promise<void> {
  await db.meta.put({ key: ACCESS_KEY, value: 'lost' });
}
