import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import type { Correction, Dog, Member, Session, Unit } from '../domain/types';

const NO_DOGS: Dog[] = [];
const NO_ARCHIVED: Dog[] = [];
const NO_MEMBERS: Member[] = [];
const NO_SESSIONS: Session[] = [];
const NO_CORRECTIONS: Correction[] = [];

export interface UnitData {
  /** Active (not archived) dogs, by name. */
  dogs: Dog[];
  /** Archived dogs, by name. Only trainers are shown them. */
  archivedDogs: Dog[];
  members: Member[];
  sessions: Session[];
  corrections: Correction[];
  unit: Unit | undefined;
  /** True until every local query has answered once, so screens can avoid flashing "not found". */
  loading: boolean;
}

/** Everything the screens read, live from the local database. */
export function useUnitData(): UnitData {
  const dogs = useLiveQuery(async () =>
    (await db.dogs.toArray())
      .filter((d) => d.archived_at === null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), []);
  const archivedDogs = useLiveQuery(async () =>
    (await db.dogs.toArray())
      .filter((d) => d.archived_at !== null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), []);
  const members = useLiveQuery(() => db.members.toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const corrections = useLiveQuery(() => db.corrections.toArray(), []);
  const unit = useLiveQuery(() => db.units.toCollection().first(), []);
  return {
    dogs: dogs ?? NO_DOGS,
    archivedDogs: archivedDogs ?? NO_ARCHIVED,
    members: members ?? NO_MEMBERS,
    sessions: sessions ?? NO_SESSIONS,
    corrections: corrections ?? NO_CORRECTIONS,
    unit,
    loading: dogs === undefined || archivedDogs === undefined || members === undefined || sessions === undefined || corrections === undefined,
  };
}
