// Team actions (spec §13.1). Like the dog actions in repo.ts they work offline: they change the local
// store and queue the change in the outbox. Trainers only; the database enforces the same by RLS.
import { selectedOdourIds, teamOdourId } from '../domain/odours';
import { requirePlannedDogs } from '../domain/plannedDogs';
import type { Odour, Team, TeamOdour } from '../domain/types';
import { cleanName, idOf, nowOf, requireTrainer, runningSessionForDog, writeAll, type Ctx, type WriteOp } from './repo';

async function requireTeam(c: Ctx, teamId: string): Promise<Team> {
  const team = await c.db.teams.get(teamId);
  if (!team || team.unit_id !== c.me.unit_id) throw new Error('Team not found');
  return team;
}

/** The odours to tick: they must exist in this unit's catalogue and not be archived. At least one. */
async function requireOdours(c: Ctx, odourIds: string[]): Promise<Odour[]> {
  const ids = [...new Set(odourIds)];
  if (ids.length === 0) throw new Error('Pick at least one odour for the team');
  const found = await c.db.odours.bulkGet(ids);
  if (found.some((o) => !o || o.unit_id !== c.me.unit_id || o.archived_at !== null)) {
    throw new Error('One of those odours is unknown or archived');
  }
  return found as Odour[];
}

const choice = (teamId: string, odourId: string, unitId: string, selected: boolean): TeamOdour =>
  ({ id: teamOdourId(teamId, odourId), team_id: teamId, odour_id: odourId, unit_id: unitId, selected });

/**
 * A team, the odours it trains on and the number of dogs it is planned to hold, in one step (spec §13.1: "name +
 * which odours it trains"). The number is a plan, no dogs are created, and it is required here (a whole number,
 * 1 or more) although the column is nullable, so that teams from before the number was asked for stay legal.
 */
export async function createTeam(c: Ctx, name: string, odourIds: string[], plannedDogs: number): Promise<Team> {
  requireTrainer(c);
  const clean = cleanName(name, 'Team');
  const planned = requirePlannedDogs(plannedDogs);
  const odours = await requireOdours(c, odourIds);
  const team: Team = {
    id: idOf(c), unit_id: c.me.unit_id, name: clean, created_by: c.me.id,
    created_at: nowOf(c).toISOString(), archived_at: null, planned_dogs: planned,
  };
  await writeAll(c, [
    { table: 'teams', op: 'insert', row: { ...team } },
    ...odours.map((o): WriteOp => ({ table: 'team_odours', op: 'insert', row: { ...choice(team.id, o.id, team.unit_id, true) } })),
  ]);
  return team;
}

export async function renameTeam(c: Ctx, teamId: string, name: string): Promise<void> {
  requireTrainer(c);
  const clean = cleanName(name, 'Team');
  await requireTeam(c, teamId);
  await writeAll(c, [{ table: 'teams', op: 'update', row: { id: teamId, name: clean } }]);
}

/** Set or change the number of dogs the team is planned to hold (also for a team made before it was asked for). */
export async function setTeamPlannedDogs(c: Ctx, teamId: string, plannedDogs: number): Promise<void> {
  requireTrainer(c);
  const planned = requirePlannedDogs(plannedDogs);
  await requireTeam(c, teamId);
  await writeAll(c, [{ table: 'teams', op: 'update', row: { id: teamId, planned_dogs: planned } }]);
}

/** Refused while a dog of the team has a running timer. The team and its dogs then disappear for everyone. */
export async function archiveTeam(c: Ctx, teamId: string): Promise<void> {
  requireTrainer(c);
  const team = await requireTeam(c, teamId);
  if (team.archived_at !== null) return;
  for (const dogId of await c.db.dogs.where('team_id').equals(teamId).primaryKeys()) {
    if (await runningSessionForDog(c.db, dogId)) throw new Error('Stop the running timer before archiving');
  }
  await writeAll(c, [{ table: 'teams', op: 'update', row: { id: teamId, archived_at: nowOf(c).toISOString() } }]);
}

export async function restoreTeam(c: Ctx, teamId: string): Promise<void> {
  requireTrainer(c);
  await requireTeam(c, teamId);
  await writeAll(c, [{ table: 'teams', op: 'update', row: { id: teamId, archived_at: null } }]);
}

/**
 * Set exactly which odours a team trains on. Rows are never deleted: an unticked odour keeps its row with
 * `selected: false`. Only changes are written. An archived odour keeps whatever choice it had, so
 * restoring it brings the team's choice back.
 */
export async function setTeamOdours(c: Ctx, teamId: string, odourIds: string[]): Promise<void> {
  requireTrainer(c);
  await requireTeam(c, teamId);
  await requireOdours(c, odourIds);
  const wanted = new Set(odourIds);
  const existing = new Map((await c.db.team_odours.where('team_id').equals(teamId).toArray()).map((t) => [t.odour_id, t]));
  const ticked = selectedOdourIds([...existing.values()], teamId);
  const ops: WriteOp[] = [];
  for (const odour of await c.db.odours.where('unit_id').equals(c.me.unit_id).toArray()) {
    if (odour.archived_at !== null) continue;
    const want = wanted.has(odour.id);
    const row = existing.get(odour.id);
    if (row ? ticked.has(odour.id) !== want : want) {
      ops.push({ table: 'team_odours', op: row ? 'update' : 'insert', row: { ...choice(teamId, odour.id, c.me.unit_id, want) } });
    }
  }
  if (ops.length > 0) await writeAll(c, ops);
}
