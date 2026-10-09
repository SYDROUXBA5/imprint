import { beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB } from '../../src/data/db';
import { addDog, startSession, stopSession, type Ctx } from '../../src/data/repo';
import type { RemoteError, RemoteStore } from '../../src/data/remote';
import { pullChanges, pushOutbox, syncStatus } from '../../src/data/sync';
import type { Member } from '../../src/domain/types';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };

function fakeRemote(failures: (RemoteError | null)[] = []) {
  const calls: { op: string; table: string; row: Record<string, unknown> }[] = [];
  const serverRows: Record<string, Record<string, unknown>[]> = {};
  const remote: RemoteStore = {
    async insert(table, row) { const f = failures.shift(); if (f) return { error: f }; calls.push({ op: 'insert', table, row }); return {}; },
    async update(table, id, patch) { const f = failures.shift(); if (f) return { error: f }; calls.push({ op: 'update', table, row: { id, ...patch } }); return {}; },
    async changesSince(table) { return { rows: serverRows[table] ?? [] }; },
  };
  return { remote, calls, serverRows };
}

let db: ImprintDB;
let n = 0;
const ctx = (): Ctx => ({ db, me: trainer, now: () => new Date('2026-10-03T10:00:00Z'), uuid: () => `id-${++n}` });
const now = () => new Date('2026-10-03T10:30:00Z');

beforeEach(() => { db = new ImprintDB(`sync-${Math.random()}`); n = 0; });

describe('pushOutbox', () => {
  it('pushes in order, adds client_sent_at to sessions, strips server fields, clears outbox', async () => {
    const dog = await addDog(ctx(), 'Rex');
    const s = await startSession(ctx(), dog.id, 'mdma');
    await stopSession(ctx(), s.id);
    expect((await syncStatus(db)).pending).toBe(2); // dog + session; Start and Stop count once
    const { remote, calls } = fakeRemote();
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 3, rejected: 0, stalled: false });
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(['insert:dogs', 'insert:sessions', 'update:sessions']);
    expect(calls[1].row.client_sent_at).toBe('2026-10-03T10:30:00.000Z');
    expect(calls[1].row).not.toHaveProperty('server_received_at');
    expect(calls[1].row).not.toHaveProperty('client_clock_offset_s');
    expect(await db.outbox.count()).toBe(0);
  });

  it('stops at a network error and keeps the rest for later', async () => {
    await addDog(ctx(), 'Rex');
    await addDog(ctx(), 'Max');
    const { remote, calls } = fakeRemote([{ message: 'Failed to fetch' }]);
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res.stalled).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await db.outbox.count()).toBe(2);
  });

  it('marks a permission error as rejected and carries on', async () => {
    await addDog(ctx(), 'Rex');
    await addDog(ctx(), 'Max');
    const { remote, calls } = fakeRemote([{ code: '42501', message: 'new row violates row-level security policy' }]);
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 1, rejected: 1, stalled: false });
    expect(calls).toHaveLength(1);
    const status = await syncStatus(db);
    expect(status).toMatchObject({ pending: 0, rejected: 1 });
  });
});

describe('pullChanges', () => {
  it('stores server rows and moves the cursor', async () => {
    const { remote, serverRows } = fakeRemote();
    serverRows.dogs = [{ id: 'd9', unit_id: 'u1', name: 'Bella', created_by: 'mT', created_at: '', archived_at: null, updated_at: '2026-10-03T09:00:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.dogs.get('d9'))?.name).toBe('Bella');
    expect((await db.meta.get('cursor:dogs'))?.value).toBe('2026-10-03T09:00:00.000Z');
  });

  it('does not overwrite rows that still have unsent local changes', async () => {
    const dog = await addDog(ctx(), 'Rex');
    const s = await startSession(ctx(), dog.id, 'mdma');
    await stopSession(ctx(), s.id);
    const { remote, serverRows } = fakeRemote();
    serverRows.sessions = [{ ...(await db.sessions.get(s.id)), ended_at: null, duration_s: null, updated_at: '2026-10-03T10:01:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.sessions.get(s.id))?.ended_at).not.toBeNull();
  });
});

describe('syncStatus', () => {
  it('warns when the oldest pending item is over 24 h old', async () => {
    await addDog(ctx(), 'Rex');
    const later = new Date('2026-10-04T10:00:01Z');
    expect(await syncStatus(db, later)).toMatchObject({ pending: 1, stale: true });
    expect(await syncStatus(db, new Date('2026-10-03T12:00:00Z'))).toMatchObject({ stale: false });
  });
});
