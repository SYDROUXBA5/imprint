import { useLiveQuery } from 'dexie-react-hooks';
import { db, ME_KEY } from '../data/db';
import type { Member } from '../domain/types';

/** undefined = still loading, null = not signed in / no unit. */
export function useMe(): Member | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get(ME_KEY))?.value as Member) ?? null, []);
}
