import { beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB } from '../../src/data/db';
import { addCorrection, addDog, moveDog, startSession, stopSession, type Ctx } from '../../src/data/repo';
import { archiveTeam, createTeam, setTeamOdours, setTeamPlannedDogs } from '../../src/data/teams';
import type { RemoteError, RemoteStore } from '../../src/data/remote';
import { pullChanges, pushOutbox, syncOnce, syncStatus, takeNotices } from '../../src/data/sync';
import type { Member } from '../../src/domain/types';
import { seedCatalogue } from '../fixtures';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: null, name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };

function fakeRemote(failures: (RemoteError | null)[] = [], access: (boolean | undefined)[] = []) {
  const calls: { op: string; table: string; row: Record<string, unknown> }[] = [];
  const serverRows: Record<string, Record<string, unknown>[]> = {};
  const remote: RemoteStore = {
    // true unless the test queued an answer: false = the server no longer lets this phone in, undefined = could not tell
    async hasAccess() { return access.length ? access.shift() : true; },
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

beforeEach(async () => {
  db = new ImprintDB(`sync-${Math.random()}`);
  n = 0;
  await seedCatalogue(db); // the default catalogue and team t1, which trains on all of it
});

describe('pushOutbox', () => {
  it('pushes in order, adds client_sent_at to sessions, strips server fields, clears outbox', async () => {
    const dog = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
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
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    await addDog(ctx(), 'Max', 't1', 'labrador', 'single');
    const { remote, calls } = fakeRemote([{ message: 'Failed to fetch' }]);
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res.stalled).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await db.outbox.count()).toBe(2);
  });

  it('marks a permission error as rejected and carries on', async () => {
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    await addDog(ctx(), 'Max', 't1', 'labrador', 'single');
    const { remote, calls } = fakeRemote([{ code: '42501', message: 'new row violates row-level security policy' }]);
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 1, rejected: 1, stalled: false });
    expect(calls).toHaveLength(1);
    const status = await syncStatus(db);
    expect(status).toMatchObject({ pending: 0, rejected: 1 });
  });
});

describe('losing access', () => {
  it('syncOnce asks first: with no access nothing is pushed or pulled, and the unsent work stays pending', async () => {
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const { remote, calls } = fakeRemote([], [false]);
    const res = await syncOnce({ db, remote, unitId: 'u1', now });
    expect(res.lostAccess).toBe(true);
    expect(calls).toHaveLength(0);
    expect((await syncStatus(db)).pending).toBe(1);
    expect((await syncStatus(db)).rejected).toBe(0);
  });

  it('a refusal that comes from losing access mid-cycle is not a rejection: the work stays pending for the new link', async () => {
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const { remote } = fakeRemote([{ code: '42501', message: 'new row violates row-level security policy' }], [true, false]);
    const res = await syncOnce({ db, remote, unitId: 'u1', now });
    expect(res.lostAccess).toBe(true);
    expect(await db.outbox.where('status').equals('pending').count()).toBe(1);
    expect(await db.outbox.where('status').equals('rejected').count()).toBe(0);
  });

  it('a refusal while the phone still has access is a real rejection, as before', async () => {
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const { remote } = fakeRemote([{ code: '42501', message: 'new row violates row-level security policy' }], [true, true]);
    const res = await syncOnce({ db, remote, unitId: 'u1', now });
    expect(res.lostAccess).toBeUndefined();
    expect(res.rejected).toBe(1);
  });

  it('not being able to tell (no signal) is not losing access', async () => {
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const { remote, calls } = fakeRemote([], [undefined]);
    const res = await syncOnce({ db, remote, unitId: 'u1', now });
    expect(res.lostAccess).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe('pullChanges', () => {
  it('stores server rows and moves the cursor', async () => {
    const { remote, serverRows } = fakeRemote();
    serverRows.dogs = [{ id: 'd9', unit_id: 'u1', team_id: 't1', breed: 'hound', purpose: 'dual', name: 'Bella', created_by: 'mT', created_at: '', archived_at: null, updated_at: '2026-10-03T09:00:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.dogs.get('d9'))?.name).toBe('Bella');
    expect((await db.meta.get('cursor:dogs'))?.value).toBe('2026-10-03T09:00:00.000Z');
  });

  it('does not overwrite rows that still have unsent local changes', async () => {
    const dog = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
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
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const later = new Date('2026-10-04T10:00:01Z');
    expect(await syncStatus(db, later)).toMatchObject({ pending: 1, stale: true });
    expect(await syncStatus(db, new Date('2026-10-03T12:00:00Z'))).toMatchObject({ stale: false });
  });
});

const tombstone = (dogId: string) => ({
  dog_id: dogId, unit_id: 'u1', deleted_by: 'mT',
  deleted_at: '2026-10-03T10:20:00.000Z', updated_at: '2026-10-03T10:20:00.000Z',
});
const FK = { code: '23503', message: 'insert or update on table "sessions" violates foreign key constraint' };
const GONE = 'A session for a deleted dog was discarded.';

describe('deleted dogs (tombstones)', () => {
  it('purges the dog, its sessions, corrections and every outbox item that refers to them', async () => {
    const rex = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const max = await addDog(ctx(), 'Max', 't1', 'labrador', 'single');
    const rexSession = await startSession(ctx(), rex.id, 'mdma');
    await stopSession(ctx(), rexSession.id);
    await addCorrection(ctx(), rexSession.id, { void: true, reason: 'wrong dog' });
    const maxSession = await startSession(ctx(), max.id, 'cocaine');
    // a stuck (rejected) item for Rex must go too
    const stuck = (await db.outbox.toArray()).find((i) => i.table === 'sessions' && i.op === 'insert' && i.row.id === rexSession.id)!;
    await db.outbox.update(stuck.seq!, { status: 'rejected', error: 'x' });

    const { remote, serverRows } = fakeRemote();
    serverRows.deleted_dogs = [tombstone(rex.id)];
    await pullChanges({ db, remote, unitId: 'u1', now });

    expect(await db.dogs.get(rex.id)).toBeUndefined();
    expect(await db.sessions.get(rexSession.id)).toBeUndefined();
    expect(await db.corrections.count()).toBe(0);
    expect((await db.dogs.get(max.id))?.name).toBe('Max');
    expect(await db.sessions.get(maxSession.id)).toBeDefined();
    const left = await db.outbox.toArray();
    expect(left.map((i) => `${i.table}:${i.op}:${i.row.id}`)).toEqual([
      `dogs:insert:${max.id}`, `sessions:insert:${maxSession.id}`,
    ]);
    expect((await db.meta.get('cursor:deleted_dogs'))?.value).toBe('2026-10-03T10:20:00.000Z');
  });

  it('applies a tombstone even when the dog has unsent local changes, and tolerates an unknown dog', async () => {
    const rex = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const { remote, serverRows } = fakeRemote();
    serverRows.deleted_dogs = [tombstone(rex.id), tombstone('never-seen-here')];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect(await db.dogs.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('drops an insert whose dog was deleted elsewhere, and says so once', async () => {
    const failures: (RemoteError | null)[] = [];
    const { remote, serverRows } = fakeRemote(failures);
    const rex = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    await pushOutbox({ db, remote, unitId: 'u1', now }); // Rex reached the server
    const s = await startSession(ctx(), rex.id, 'mdma');
    await stopSession(ctx(), s.id);
    failures.push(FK); // someone deleted Rex forever: the session insert hits the FK

    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 0, rejected: 0, stalled: false });
    expect(await db.outbox.count()).toBe(0); // insert and its Stop are both gone, nothing stuck
    expect(await takeNotices(db)).toEqual([GONE]);
    expect(await takeNotices(db)).toEqual([]);

    // the tombstone then clears the local copy
    serverRows.deleted_dogs = [tombstone(rex.id)];
    await syncOnce({ db, remote, unitId: 'u1', now });
    expect(await db.dogs.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  });

  it('drops a correction whose session vanished with the dog, with its own notice', async () => {
    const failures: (RemoteError | null)[] = [];
    const { remote } = fakeRemote(failures);
    const rex = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const s = await startSession(ctx(), rex.id, 'mdma');
    await pushOutbox({ db, remote, unitId: 'u1', now });
    await addCorrection(ctx(), s.id, { void: true, reason: 'oops' });
    failures.push({ ...FK, message: 'violates foreign key constraint on corrections' });
    await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(await db.outbox.count()).toBe(0);
    expect(await takeNotices(db)).toEqual(['A correction for a deleted dog was discarded.']);
  });

  it('keeps an FK failure as rejected when the dog itself never reached the server', async () => {
    const failures: (RemoteError | null)[] = [{ code: '42501', message: 'row-level security' }];
    const { remote } = fakeRemote(failures);
    const rex = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    await startSession(ctx(), rex.id, 'mdma');
    failures.push(FK); // dog insert rejected above; the session then fails its FK as a consequence
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 0, rejected: 2, stalled: false });
    expect(await syncStatus(db)).toMatchObject({ pending: 0, rejected: 2 });
    expect(await takeNotices(db)).toEqual([]);
  });
});

const teamTombstone = (teamId: string) => ({
  team_id: teamId, unit_id: 'u1', deleted_by: 'mT',
  deleted_at: '2026-10-03T10:25:00.000Z', updated_at: '2026-10-03T10:25:00.000Z',
});

describe('teams, catalogue and team odours', () => {
  it('pushes a new team before its odour choices, and a choice goes up as an overwrite whatever its op', async () => {
    const t = await createTeam(ctx(), 'Bravo', ['mdma'], 6);
    await setTeamOdours(ctx(), t.id, ['mdma', 'tnt']);
    await setTeamOdours(ctx(), t.id, ['tnt']); // mdma off
    const { remote, calls } = fakeRemote();
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toMatchObject({ rejected: 0, stalled: false });
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      'insert:teams', 'insert:team_odours', 'insert:team_odours', 'insert:team_odours',
    ]);
    // team_odours has no id on the server: the synthetic local key must not be sent
    const picks = calls.filter((c) => c.table === 'team_odours').map((c) => c.row);
    for (const r of picks) expect(r).not.toHaveProperty('id');
    expect(picks.map((r) => [r.odour_id, r.selected])).toEqual([['mdma', true], ['tnt', true], ['mdma', false]]);
    expect(picks[0]).toEqual({ team_id: t.id, odour_id: 'mdma', unit_id: 'u1', selected: true });
    expect(await db.outbox.count()).toBe(0);
  });

  it('pushes catalogue edits and a moved dog as updates', async () => {
    const dog = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const bravo = await createTeam(ctx(), 'Bravo', ['mdma'], 6);
    await moveDog(ctx(), dog.id, bravo.id);
    await archiveTeam(ctx(), bravo.id);
    const { remote, calls } = fakeRemote();
    await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(calls.filter((c) => c.op === 'update').map((c) => [c.table, c.row])).toEqual([
      ['dogs', { id: dog.id, team_id: bravo.id }],
      ['teams', { id: bravo.id, archived_at: '2026-10-03T10:00:00.000Z' }],
    ]);
  });

  it('a name clash on the server (unique violation) is rejected for good instead of blocking everything behind it', async () => {
    const { remote } = fakeRemote([{ code: '23505', message: 'duplicate key value violates unique constraint "odour_categories_name_uq"' }]);
    await db.outbox.clear();
    const { addCategory } = await import('../../src/data/catalogue');
    await addCategory(ctx(), 'Currency');
    await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 1, rejected: 1, stalled: false });
    expect(await syncStatus(db)).toMatchObject({ pending: 0, rejected: 1 });
  });

  it('pulls the new tables in dependency order, and gives team_odours rows their local key', async () => {
    const { remote, serverRows } = fakeRemote();
    const seen: string[] = [];
    const spy = remote.changesSince.bind(remote);
    remote.changesSince = async (table, unit, since) => { seen.push(table); return spy(table, unit, since); };
    serverRows.teams = [{ id: 't2', unit_id: 'u1', name: 'Bravo', created_by: 'mT', created_at: '', archived_at: null, updated_at: '2026-10-03T09:00:00.000Z' }];
    serverRows.odour_categories = [{ id: 'c9', unit_id: 'u1', name: 'Currency', sort: 5, created_at: '', archived_at: null, updated_at: '2026-10-03T09:01:00.000Z' }];
    serverRows.odours = [{ id: 'o9', unit_id: 'u1', category_id: 'c9', name: 'Banknotes', created_at: '', archived_at: null, updated_at: '2026-10-03T09:02:00.000Z' }];
    serverRows.team_odours = [{ team_id: 't2', odour_id: 'o9', unit_id: 'u1', selected: true, updated_at: '2026-10-03T09:03:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect(seen).toEqual([
      'units', 'members', 'teams', 'odour_categories', 'odours', 'team_odours', 'dogs', 'sessions', 'corrections', 'deleted_teams', 'deleted_dogs',
    ]);
    expect((await db.teams.get('t2'))?.name).toBe('Bravo');
    expect((await db.odour_categories.get('c9'))?.name).toBe('Currency');
    expect((await db.odours.get('o9'))?.category_id).toBe('c9');
    expect(await db.team_odours.get('t2:o9')).toMatchObject({ id: 't2:o9', team_id: 't2', odour_id: 'o9', selected: true });
    expect((await db.meta.get('cursor:team_odours'))?.value).toBe('2026-10-03T09:03:00.000Z');
  });

  it('does not overwrite a team odour choice that still has an unsent local change', async () => {
    await setTeamOdours(ctx(), 't1', ['mdma']); // everything else off, queued
    const { remote, serverRows } = fakeRemote();
    serverRows.team_odours = [{ team_id: 't1', odour_id: 'tnt', unit_id: 'u1', selected: true, updated_at: '2026-10-03T10:01:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.team_odours.get('t1:tnt'))?.selected).toBe(false);
  });

  it('the planned number of dogs goes up with the new team and as a one-field update', async () => {
    const t = await createTeam(ctx(), 'Bravo', ['mdma'], 6);
    await setTeamPlannedDogs(ctx(), t.id, 8);
    await setTeamPlannedDogs(ctx(), 't1', 3); // a team from before the number was asked for
    const { remote, calls } = fakeRemote();
    await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(calls.find((c) => c.op === 'insert' && c.table === 'teams')!.row).toMatchObject({ id: t.id, name: 'Bravo', planned_dogs: 6 });
    expect(calls.filter((c) => c.op === 'update').map((c) => [c.table, c.row])).toEqual([
      ['teams', { id: t.id, planned_dogs: 8 }],
      ['teams', { id: 't1', planned_dogs: 3 }],
    ]);
  });

  it('pulls the planned number of dogs, and a change to it, and keeps a team without one at null', async () => {
    const { remote, serverRows } = fakeRemote();
    serverRows.teams = [
      { id: 't2', unit_id: 'u1', name: 'Bravo', created_by: 'mT', created_at: '', archived_at: null, planned_dogs: 6, updated_at: '2026-10-03T09:00:00.000Z' },
      { id: 't3', unit_id: 'u1', name: 'Old', created_by: 'mT', created_at: '', archived_at: null, planned_dogs: null, updated_at: '2026-10-03T09:00:01.000Z' },
    ];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.teams.get('t2'))!.planned_dogs).toBe(6);
    expect((await db.teams.get('t3'))!.planned_dogs).toBeNull();
    serverRows.teams = [{ ...serverRows.teams[0], planned_dogs: 9, updated_at: '2026-10-03T09:05:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.teams.get('t2'))!.planned_dogs).toBe(9);
  });

  it('does not overwrite a planned number of dogs that still has an unsent local change', async () => {
    await setTeamPlannedDogs(ctx(), 't1', 5);
    const { remote, serverRows } = fakeRemote();
    serverRows.teams = [{ ...(await db.teams.get('t1')), planned_dogs: 99, updated_at: '2026-10-03T10:01:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.teams.get('t1'))!.planned_dogs).toBe(5);
  });

  it('syncStatus counts a team and its choices as the records they are', async () => {
    await createTeam(ctx(), 'Bravo', ['mdma', 'tnt'], 6);
    expect((await syncStatus(db)).pending).toBe(3); // the team and two choices
  });
});

describe('deleted teams (tombstones)', () => {
  /** Team t1 holds Rex and Fly with history; Bravo holds Max, who must survive. */
  async function world() {
    const rex = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const fly = await addDog(ctx(), 'Fly', 't1', 'hound', 'dual');
    const bravo = await createTeam(ctx(), 'Bravo', ['mdma'], 6);
    const max = await addDog(ctx(), 'Max', bravo.id, 'other', 'single');
    const rexSession = await startSession(ctx(), rex.id, 'mdma');
    await stopSession(ctx(), rexSession.id);
    await addCorrection(ctx(), rexSession.id, { void: true, reason: 'wrong dog' });
    const flySession = await startSession(ctx(), fly.id, 'tnt');
    const maxSession = await startSession(ctx(), max.id, 'cocaine');
    return { rex, fly, bravo, max, rexSession, flySession, maxSession };
  }

  it('purges the team, its dogs, their sessions, corrections and odour choices, and the unsent changes for them', async () => {
    const w = await world();
    const stuck = (await db.outbox.toArray()).find((i) => i.table === 'dogs' && i.row.id === w.rex.id)!;
    await db.outbox.update(stuck.seq!, { status: 'rejected', error: 'x' });
    const { remote, serverRows } = fakeRemote();
    serverRows.deleted_teams = [teamTombstone('t1')];
    await pullChanges({ db, remote, unitId: 'u1', now });

    expect(await db.teams.get('t1')).toBeUndefined();
    expect(await db.dogs.where('team_id').equals('t1').count()).toBe(0);
    expect(await db.sessions.where('dog_id').anyOf([w.rex.id, w.fly.id]).count()).toBe(0);
    expect(await db.corrections.count()).toBe(0);
    expect(await db.team_odours.where('team_id').equals('t1').count()).toBe(0);
    // everything of Bravo is still here
    expect((await db.teams.get(w.bravo.id))?.name).toBe('Bravo');
    expect((await db.dogs.get(w.max.id))?.name).toBe('Max');
    expect(await db.sessions.get(w.maxSession.id)).toBeDefined();
    expect(await db.team_odours.where('team_id').equals(w.bravo.id).count()).toBe(1);
    // the catalogue is not the team's
    expect(await db.odours.count()).toBe(20);
    expect((await db.outbox.toArray()).map((i) => `${i.table}:${i.op}:${i.row.id}`)).toEqual([
      `teams:insert:${w.bravo.id}`, `team_odours:insert:${w.bravo.id}:mdma`,
      `dogs:insert:${w.max.id}`, `sessions:insert:${w.maxSession.id}`,
    ]);
    expect((await db.meta.get('cursor:deleted_teams'))?.value).toBe('2026-10-03T10:25:00.000Z');
  });

  it('drops an unsent dog that was being added to the deleted team, and tolerates an unknown team', async () => {
    const rex = await addDog(ctx(), 'Rex', 't1', 'labrador', 'single');
    const { remote, serverRows } = fakeRemote();
    serverRows.deleted_teams = [teamTombstone('t1'), teamTombstone('never-seen-here')];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect(await db.dogs.get(rex.id)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('a dog moved out of the deleted team earlier on this phone is not deleted with it', async () => {
    const w = await world();
    await moveDog(ctx(), w.rex.id, w.bravo.id);
    const { remote, serverRows } = fakeRemote();
    serverRows.deleted_teams = [teamTombstone('t1')];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.dogs.get(w.rex.id))?.team_id).toBe(w.bravo.id);
    expect(await db.dogs.get(w.fly.id)).toBeUndefined();
  });
});
