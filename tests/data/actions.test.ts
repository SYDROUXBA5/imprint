import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Correction, Dog, Member, Session } from '../../src/domain/types';

const fake = { rpc: vi.fn() };
vi.mock('../../src/data/supabase', () => ({ supabase: fake }));

const { deleteDogForever, restoreDog } = await import('../../src/data/actions');
const { NotAllowedError } = await import('../../src/data/repo');
const { db } = await import('../../src/data/db');

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { ...trainer, id: 'mH', user_id: 'uH', name: 'Paul', role: 'handler' };
const ctx = (me: Member) => ({ db, me });

const dog = (id: string, name: string, archived: string | null): Dog => ({
  id, unit_id: 'u1', name, created_by: 'mT', created_at: '2026-10-01T00:00:00Z', archived_at: archived,
});
const session = (id: string, dogId: string): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: 'mdma', handler_id: 'mH', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: 600, client_clock_offset_s: null, server_received_at: null,
});
const correction = (id: string, sessionId: string): Correction => ({
  id, session_id: sessionId, unit_id: 'u1', trainer_id: 'mT', void: true, new_duration_s: null,
  reason: 'x', created_at: '2026-10-04T00:00:00Z',
});

let online = true;
beforeEach(async () => {
  vi.clearAllMocks();
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  fake.rpc.mockResolvedValue({ data: null, error: null });
  await db.delete();
  await db.open();
  await db.dogs.bulkPut([dog('d1', 'Bella', '2026-10-05T00:00:00Z'), dog('d2', 'Rex', null)]);
  await db.sessions.bulkPut([session('s1', 'd1'), session('s2', 'd1'), session('s3', 'd2')]);
  await db.corrections.bulkPut([correction('c1', 's1'), correction('c2', 's3')]);
  await db.outbox.bulkAdd([
    { table: 'sessions', op: 'insert', row: { ...session('s2', 'd1') }, created_at: '', status: 'pending' },
    { table: 'sessions', op: 'insert', row: { ...session('s3', 'd2') }, created_at: '', status: 'pending' },
  ]);
});

describe('restoreDog', () => {
  it('clears archived_at locally and queues the change for sync', async () => {
    await db.outbox.clear();
    await restoreDog(ctx(trainer), 'd1');
    expect((await db.dogs.get('d1'))!.archived_at).toBeNull();
    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ table: 'dogs', op: 'update', status: 'pending', row: { id: 'd1', archived_at: null } });
  });

  it('works with no signal: it never calls the server', async () => {
    online = false;
    await restoreDog(ctx(trainer), 'd1');
    expect((await db.dogs.get('d1'))!.archived_at).toBeNull();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('is refused for a handler', async () => {
    await expect(restoreDog(ctx(handler), 'd1')).rejects.toBeInstanceOf(NotAllowedError);
    expect((await db.dogs.get('d1'))!.archived_at).not.toBeNull();
  });
});

describe('deleteDogForever', () => {
  it('asks the server to delete the archived dog, then purges it from this phone', async () => {
    await deleteDogForever(ctx(trainer), 'd1');
    expect(fake.rpc).toHaveBeenCalledWith('delete_dog_forever', { dog: 'd1' });
    expect(await db.dogs.get('d1')).toBeUndefined();
    expect(await db.sessions.where('dog_id').equals('d1').count()).toBe(0);
    expect(await db.corrections.get('c1')).toBeUndefined();
    // Unsent changes for that dog go too; other dogs are untouched.
    const left = await db.outbox.toArray();
    expect(left).toHaveLength(1);
    expect(left[0].row.id).toBe('s3');
    expect(await db.dogs.get('d2')).toBeDefined();
    expect(await db.sessions.get('s3')).toBeDefined();
    expect(await db.corrections.get('c2')).toBeDefined();
  });

  it('is online-only: with no signal it says so and does nothing', async () => {
    online = false;
    await expect(deleteDogForever(ctx(trainer), 'd1')).rejects.toThrow('Needs signal.');
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(await db.dogs.get('d1')).toBeDefined();
  });

  it('keeps everything and shows the server reason when the server refuses', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { message: 'stop the running timer before deleting' } });
    await expect(deleteDogForever(ctx(trainer), 'd1')).rejects.toThrow('Stop the running timer before deleting');
    expect(await db.dogs.get('d1')).toBeDefined();
    expect(await db.sessions.where('dog_id').equals('d1').count()).toBe(2);
  });

  it('is refused for a handler before it reaches the server', async () => {
    await expect(deleteDogForever(ctx(handler), 'd1')).rejects.toBeInstanceOf(NotAllowedError);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(await db.dogs.get('d1')).toBeDefined();
  });
});
