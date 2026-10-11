import { useLiveQuery } from 'dexie-react-hooks';
import { readAccess, type Access } from '../data/access';
import type { Me } from '../domain/types';

/** Where this phone stands: no way in, entered but no name yet, locked out, or in. undefined = still reading. */
export function useAccess(): Access | undefined {
  return useLiveQuery(() => readAccess(), []);
}

/** The name this phone is signed in under, with the power of its link. undefined = loading, null = not in. */
export function useMe(): Me | null | undefined {
  const access = useAccess();
  if (access === undefined) return undefined;
  return access.kind === 'in' ? access.me : null;
}
