import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../data/db';
import type {
  Catalogue, Correction, Dog, Member, Odour, OdourCategory, Session, Team, TeamOdour, Unit,
} from '../domain/types';

const NO_DOGS: Dog[] = [];
const NO_TEAMS: Team[] = [];
const NO_MEMBERS: Member[] = [];
const NO_SESSIONS: Session[] = [];
const NO_CORRECTIONS: Correction[] = [];
const NO_CATEGORIES: OdourCategory[] = [];
const NO_ODOURS: Odour[] = [];
const NO_TEAM_ODOURS: TeamOdour[] = [];

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export interface UnitData {
  /** Active (not archived) dogs that are in an active team, by name. */
  dogs: Dog[];
  /** Archived dogs that are in an active team, by name. Only trainers are shown them. */
  archivedDogs: Dog[];
  /** Every dog, whatever its state or its team's. For screens that decide for themselves. */
  allDogs: Dog[];
  /** Active teams, by name. */
  teams: Team[];
  /** Archived teams, by name. Only trainers are shown them. */
  archivedTeams: Team[];
  /** The unit's whole odour catalogue, archived rows included (history needs their names). */
  categories: OdourCategory[];
  odours: Odour[];
  teamOdours: TeamOdour[];
  /** The three catalogue lists together, for the helpers in domain/odours. */
  catalogue: Catalogue;
  members: Member[];
  sessions: Session[];
  corrections: Correction[];
  unit: Unit | undefined;
  /** True until every local query has answered once, so screens can avoid flashing "not found". */
  loading: boolean;
}

/** Everything the screens read, live from the local database. */
export function useUnitData(): UnitData {
  const allDogs = useLiveQuery(async () => (await db.dogs.toArray()).sort(byName), []);
  const allTeams = useLiveQuery(async () => (await db.teams.toArray()).sort(byName), []);
  const categories = useLiveQuery(() => db.odour_categories.toArray(), []);
  const odours = useLiveQuery(() => db.odours.toArray(), []);
  const teamOdours = useLiveQuery(() => db.team_odours.toArray(), []);
  const members = useLiveQuery(() => db.members.toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const corrections = useLiveQuery(() => db.corrections.toArray(), []);
  const unit = useLiveQuery(() => db.units.toCollection().first(), []);

  const teams = useMemo(() => (allTeams ?? NO_TEAMS).filter((t) => t.archived_at === null), [allTeams]);
  const archivedTeams = useMemo(() => (allTeams ?? NO_TEAMS).filter((t) => t.archived_at !== null), [allTeams]);
  const inActiveTeam = useMemo(() => {
    const ids = new Set(teams.map((t) => t.id));
    return (d: Dog) => ids.has(d.team_id);
  }, [teams]);
  const dogs = useMemo(
    () => (allDogs ?? NO_DOGS).filter((d) => d.archived_at === null && inActiveTeam(d)), [allDogs, inActiveTeam]);
  const archivedDogs = useMemo(
    () => (allDogs ?? NO_DOGS).filter((d) => d.archived_at !== null && inActiveTeam(d)), [allDogs, inActiveTeam]);
  const catalogue = useMemo<Catalogue>(() => ({
    categories: categories ?? NO_CATEGORIES, odours: odours ?? NO_ODOURS, teamOdours: teamOdours ?? NO_TEAM_ODOURS,
  }), [categories, odours, teamOdours]);

  return {
    dogs,
    archivedDogs,
    allDogs: allDogs ?? NO_DOGS,
    teams,
    archivedTeams,
    categories: catalogue.categories,
    odours: catalogue.odours,
    teamOdours: catalogue.teamOdours,
    catalogue,
    members: members ?? NO_MEMBERS,
    sessions: sessions ?? NO_SESSIONS,
    corrections: corrections ?? NO_CORRECTIONS,
    unit,
    loading: allDogs === undefined || allTeams === undefined || categories === undefined || odours === undefined
      || teamOdours === undefined || members === undefined || sessions === undefined || corrections === undefined,
  };
}
