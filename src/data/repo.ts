import { localDate } from '../domain/format';
import { isRunning } from '../domain/totals';
import type { Correction, Dog, Member, Session } from '../domain/types';
import type { ImprintDB, OutboxItem, SyncedTable } from './db';

export interface Ctx {
  db: ImprintDB;
  me: Member;
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

const nowOf = (c: Ctx) => (c.now ?? (() => new Date()))();
const idOf = (c: Ctx) => (c.uuid ?? (() => crypto.randomUUID()))();
const requireTrainer = (c: Ctx) => {
  if (c.me.role !== 'trainer') throw new NotAllowedError('Trainers only');
};

async function write(c: Ctx, table: SyncedTable, op: OutboxItem['op'], row: OutboxItem['row']) {
  await c.db.transaction('rw', c.db.table(table), c.db.outbox, async () => {
    if (op === 'insert') await c.db.table(table).add(row);
    else await c.db.table(table).update(row.id, row);
    await c.db.outbox.add({ table, op, row, created_at: nowOf(c).toISOString(), status: 'pending' });
  });
}

export async function runningSessionForDog(db: ImprintDB, dogId: string): Promise<Session | undefined> {
  const sessions = await db.sessions.where('dog_id').equals(dogId).toArray();
  const ids = sessions.map((s) => s.id);
  const corrections = await db.corrections.where('session_id').anyOf(ids).toArray();
  return sessions.find((s) => isRunning(s, corrections));
}

export async function addDog(c: Ctx, name: string): Promise<Dog> {
  requireTrainer(c);
  const clean = name.trim();
  if (!clean) throw new Error('Dog name is required');
  const dog: Dog = {
    id: idOf(c), unit_id: c.me.unit_id, name: clean, created_by: c.me.id,
    created_at: nowOf(c).toISOString(), archived_at: null,
  };
  await write(c, 'dogs', 'insert', { ...dog });
  return dog;
}

export async function renameDog(c: Ctx, dogId: string, name: string): Promise<void> {
  requireTrainer(c);
  const clean = name.trim();
  if (!clean) throw new Error('Dog name is required');
  await write(c, 'dogs', 'update', { id: dogId, name: clean });
}

export async function archiveDog(c: Ctx, dogId: string): Promise<void> {
  requireTrainer(c);
  if (await runningSessionForDog(c.db, dogId)) throw new Error('Stop the running timer before archiving');
  await write(c, 'dogs', 'update', { id: dogId, archived_at: nowOf(c).toISOString() });
}

export async function startSession(c: Ctx, dogId: string, odourId: string): Promise<Session> {
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
