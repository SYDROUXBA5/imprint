import { isBreedId, isPurpose } from '../domain/breeds';
import { localDate } from '../domain/format';
import { isRunning } from '../domain/totals';
import type { BreedId, Correction, Dog, Me, Purpose, Session } from '../domain/types';
import type { ImprintDB, OutboxItem, SyncedTable } from './db';

export interface Ctx {
  db: ImprintDB;
  me: Me;
  now?: () => Date;
  uuid?: () => string;
}

export class NotAllowedError extends Error {}
export class AlreadyRunningError extends Error {
  running: Session;
  constructor(running: Session) {
    super('A timer is already running on this dog');
    this.running = running;
  }
}

export const nowOf = (c: Ctx) => (c.now ?? (() => new Date()))();
export const idOf = (c: Ctx) => (c.uuid ?? (() => crypto.randomUUID()))();
export const requireTrainer = (c: Ctx) => {
  if (c.me.role !== 'trainer') throw new NotAllowedError('Trainers only');
};
/** A name typed by a person: trimmed, and never empty. */
export const cleanName = (name: string, what: string): string => {
  const clean = name.trim();
  if (!clean) throw new Error(`${what} name is required`);
  return clean;
};

export interface WriteOp { table: SyncedTable; op: OutboxItem['op']; row: OutboxItem['row'] }

/**
 * Apply changes to the local store and queue them for the server, all or nothing and in the order given
 * (a team before its team_odours). An insert adds the whole row; an update patches the fields given.
 */
export async function writeAll(c: Ctx, ops: WriteOp[]): Promise<void> {
  const createdAt = nowOf(c).toISOString();
  await c.db.transaction('rw', c.db.tables, async () => {
    for (const { table, op, row } of ops) {
      if (op === 'insert') await c.db.table(table).add(row);
      else await c.db.table(table).update(row.id, row);
      await c.db.outbox.add({ table, op, row, created_at: createdAt, status: 'pending' });
    }
  });
}

const write = (c: Ctx, table: SyncedTable, op: OutboxItem['op'], row: OutboxItem['row']) =>
  writeAll(c, [{ table, op, row }]);

/** The odour a session points at has to be one of this unit's catalogue; the server enforces it too. */
async function requireOdour(c: Ctx, odourId: string): Promise<void> {
  const odour = await c.db.odours.get(odourId);
  if (!odour || odour.unit_id !== c.me.unit_id) throw new Error('Unknown odour');
}

async function requireActiveTeam(c: Ctx, teamId: string): Promise<void> {
  const team = await c.db.teams.get(teamId);
  if (!team || team.unit_id !== c.me.unit_id) throw new Error('Team not found');
  if (team.archived_at !== null) throw new Error('That team is archived');
}

function checkBreed(breed: unknown): asserts breed is BreedId {
  if (!isBreedId(breed)) throw new Error('Pick a breed');
}
function checkPurpose(purpose: unknown): asserts purpose is Purpose {
  if (!isPurpose(purpose)) throw new Error('Pick single or dual purpose');
}

export async function runningSessionForDog(db: ImprintDB, dogId: string): Promise<Session | undefined> {
  const sessions = await db.sessions.where('dog_id').equals(dogId).toArray();
  const ids = sessions.map((s) => s.id);
  const corrections = await db.corrections.where('session_id').anyOf(ids).toArray();
  return sessions.find((s) => isRunning(s, corrections));
}

/** Name, team, breed and purpose are all required (spec §13.2). The team has to be active. */
export async function addDog(c: Ctx, name: string, teamId: string, breed: BreedId, purpose: Purpose): Promise<Dog> {
  requireTrainer(c);
  const clean = cleanName(name, 'Dog');
  await requireActiveTeam(c, teamId);
  checkBreed(breed);
  checkPurpose(purpose);
  const dog: Dog = {
    id: idOf(c), unit_id: c.me.unit_id, team_id: teamId, name: clean, breed, purpose, created_by: c.me.id,
    created_at: nowOf(c).toISOString(), archived_at: null,
  };
  await write(c, 'dogs', 'insert', { ...dog });
  return dog;
}

async function requireDog(c: Ctx, dogId: string): Promise<Dog> {
  const dog = await c.db.dogs.get(dogId);
  if (!dog) throw new Error('Dog not found');
  return dog;
}

/** Change a dog's name, breed or purpose; only the fields given are sent. Moving it is `moveDog`. */
export async function editDog(
  c: Ctx, dogId: string, changes: { name?: string; breed?: BreedId; purpose?: Purpose },
): Promise<void> {
  requireTrainer(c);
  await requireDog(c, dogId);
  const patch: { name?: string; breed?: BreedId; purpose?: Purpose } = {};
  if (changes.name !== undefined) patch.name = cleanName(changes.name, 'Dog');
  if (changes.breed !== undefined) { checkBreed(changes.breed); patch.breed = changes.breed; }
  if (changes.purpose !== undefined) { checkPurpose(changes.purpose); patch.purpose = changes.purpose; }
  if (Object.keys(patch).length === 0) return;
  await write(c, 'dogs', 'update', { id: dogId, ...patch });
}

export const renameDog = (c: Ctx, dogId: string, name: string): Promise<void> => editDog(c, dogId, { name });

/** Move a dog to another active team of the unit. Its history stays with it. */
export async function moveDog(c: Ctx, dogId: string, teamId: string): Promise<void> {
  requireTrainer(c);
  const dog = await requireDog(c, dogId);
  await requireActiveTeam(c, teamId);
  if (dog.team_id === teamId) return;
  await write(c, 'dogs', 'update', { id: dogId, team_id: teamId });
}

export async function archiveDog(c: Ctx, dogId: string): Promise<void> {
  requireTrainer(c);
  if (await runningSessionForDog(c.db, dogId)) throw new Error('Stop the running timer before archiving');
  await write(c, 'dogs', 'update', { id: dogId, archived_at: nowOf(c).toISOString() });
}

/** Bring an archived dog back. Offline-capable like archiving: it goes through the outbox. */
export async function restoreDog(c: Ctx, dogId: string): Promise<void> {
  requireTrainer(c);
  await write(c, 'dogs', 'update', { id: dogId, archived_at: null });
}

export async function startSession(c: Ctx, dogId: string, odourId: string): Promise<Session> {
  await requireOdour(c, odourId);
  const running = await runningSessionForDog(c.db, dogId);
  if (running) throw new AlreadyRunningError(running);
  const now = nowOf(c);
  const s: Session = {
    id: idOf(c), unit_id: c.me.unit_id, dog_id: dogId, odour_id: odourId, handler_id: c.me.id,
    kind: 'timed', session_date: localDate(now), started_at: now.toISOString(),
    ended_at: null, duration_s: null, client_clock_offset_s: null, server_received_at: null,
  };
  await write(c, 'sessions', 'insert', { ...s });
  return s;
}

export async function stopSession(c: Ctx, sessionId: string): Promise<Session> {
  const s = await c.db.sessions.get(sessionId);
  if (!s || s.kind !== 'timed' || s.ended_at) throw new Error('No running session');
  if (s.handler_id !== c.me.id) throw new NotAllowedError('Only the handler who started it can stop it');
  const end = nowOf(c);
  const duration = Math.max(0, Math.floor((end.getTime() - Date.parse(s.started_at!)) / 1000));
  const patch = { id: s.id, ended_at: end.toISOString(), duration_s: duration };
  await write(c, 'sessions', 'update', patch);
  return { ...s, ...patch };
}

export async function addManualSession(
  c: Ctx, dogId: string, odourId: string, dateYmd: string, minutes: number,
): Promise<Session> {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('Minutes must be a whole number above 0');
  await requireOdour(c, odourId);
  const s: Session = {
    id: idOf(c), unit_id: c.me.unit_id, dog_id: dogId, odour_id: odourId, handler_id: c.me.id,
    kind: 'manual', session_date: dateYmd, started_at: null, ended_at: null,
    duration_s: minutes * 60, client_clock_offset_s: null, server_received_at: null,
  };
  await write(c, 'sessions', 'insert', { ...s });
  return s;
}

export async function addCorrection(
  c: Ctx, sessionId: string,
  input: { void: true; reason: string } | { void: false; newDurationS: number; reason: string },
): Promise<Correction> {
  requireTrainer(c);
  const reason = input.reason.trim();
  if (!reason) throw new Error('A reason is required');
  if (!input.void && (!Number.isInteger(input.newDurationS) || input.newDurationS < 0)) {
    throw new Error('Duration must be 0 or more whole seconds');
  }
  const corr: Correction = {
    id: idOf(c), session_id: sessionId, unit_id: c.me.unit_id, trainer_id: c.me.id,
    void: input.void, new_duration_s: input.void ? null : input.newDurationS,
    reason, created_at: nowOf(c).toISOString(),
  };
  await write(c, 'corrections', 'insert', { ...corr });
  return corr;
}
