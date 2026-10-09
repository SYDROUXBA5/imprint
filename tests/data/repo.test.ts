import { beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB } from '../../src/data/db';
import {
  AlreadyRunningError, NotAllowedError, addCorrection, addDog, addManualSession,
  archiveDog, runningSessionForDog, startSession, stopSession, type Ctx,
} from '../../src/data/repo';
import type { Member } from '../../src/domain/types';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { ...trainer, id: 'mH', user_id: 'uH', name: 'Paul', role: 'handler' };

let db: ImprintDB;
let clock: Date;
let n = 0;
const ctx = (me: Member): Ctx => ({ db, me, now: () => clock, uuid: () => `id-${++n}` });

beforeEach(async () => {
  db = new ImprintDB(`test-${Math.random()}`);
  clock = new Date('2026-10-03T10:00:00.000Z');
  n = 0;
});

describe('repo', () => {
  it('trainer adds a dog; handler cannot', async () => {
    const dog = await addDog(ctx(trainer), '  Rex ');
    expect(dog.name).toBe('Rex');
    expect(await db.outbox.count()).toBe(1);
    await expect(addDog(ctx(handler), 'Max')).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('start then stop writes the session and two outbox items', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await startSession(ctx(handler), dog.id, 'mdma');
    expect(s.started_at).toBe('2026-10-03T10:00:00.000Z');
    clock = new Date('2026-10-03T10:12:04.700Z');
    const stopped = await stopSession(ctx(handler), s.id);
    expect(stopped.duration_s).toBe(724);
    const items = await db.outbox.orderBy('seq').toArray();
    expect(items.map((i) => `${i.table}:${i.op}`)).toEqual(['dogs:insert', 'sessions:insert', 'sessions:update']);
    expect(items[2].row).toEqual({ id: s.id, ended_at: '2026-10-03T10:12:04.700Z', duration_s: 724 });
  });

  it('only one running session per dog', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    await startSession(ctx(handler), dog.id, 'mdma');
    await expect(startSession(ctx(trainer), dog.id, 'cocaine')).rejects.toBeInstanceOf(AlreadyRunningError);
  });

  it("only the starting handler can stop", async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await startSession(ctx(handler), dog.id, 'mdma');
    await expect(stopSession(ctx(trainer), s.id)).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('manual session stores minutes as seconds', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await addManualSession(ctx(handler), dog.id, 'mdma', '2026-10-02', 10);
    expect(s).toMatchObject({ kind: 'manual', duration_s: 600, session_date: '2026-10-02', started_at: null });
    await expect(addManualSession(ctx(handler), dog.id, 'mdma', '2026-10-02', 0)).rejects.toThrow();
  });

  it('a correction closes a forgotten running session', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await startSession(ctx(handler), dog.id, 'mdma');
    await addCorrection(ctx(trainer), s.id, { void: false, newDurationS: 480, reason: 'forgot to stop' });
    expect(await runningSessionForDog(db, dog.id)).toBeUndefined();
    await expect(addCorrection(ctx(handler), s.id, { void: true, reason: 'x' })).rejects.toBeInstanceOf(NotAllowedError);
    await expect(addCorrection(ctx(trainer), s.id, { void: true, reason: '   ' })).rejects.toThrow(/reason/);
  });

  it('cannot archive a dog with a running timer', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    await startSession(ctx(handler), dog.id, 'mdma');
    await expect(archiveDog(ctx(trainer), dog.id)).rejects.toThrow(/running/);
  });
});
