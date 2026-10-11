import { beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB } from '../../src/data/db';
import {
  NotAllowedError, addDog, editDog, moveDog, renameDog, startSession, type Ctx,
} from '../../src/data/repo';
import { archiveTeam, createTeam, renameTeam, restoreTeam, setTeamOdours, setTeamPlannedDogs } from '../../src/data/teams';
import type { Member } from '../../src/domain/types';
import { dogRow, pick, seedCatalogue, team } from '../fixtures';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { ...trainer, id: 'mH', user_id: 'uH', name: 'Paul', role: 'handler' };

let db: ImprintDB;
let clock: Date;
let n = 0;
const ctx = (me: Member): Ctx => ({ db, me, now: () => clock, uuid: () => `id-${++n}` });
const outbox = async () => (await db.outbox.orderBy('seq').toArray()).map((i) => `${i.table}:${i.op}:${i.row.id}`);

beforeEach(async () => {
  db = new ImprintDB(`teams-${Math.random()}`);
  clock = new Date('2026-10-03T10:00:00.000Z');
  n = 0;
  await seedCatalogue(db, []); // the catalogue, no teams yet
});

describe('createTeam', () => {
  it('writes the team and a selected team_odours row per odour, team first, in one go', async () => {
    const t = await createTeam(ctx(trainer), '  Alpha ', ['mdma', 'tnt', 'mdma'], 6);
    expect(t).toMatchObject({ id: 'id-1', unit_id: 'u1', name: 'Alpha', created_by: 'mT', archived_at: null, planned_dogs: 6 });
    expect(await db.teams.get('id-1')).toBeDefined();
    const picks = await db.team_odours.where('team_id').equals('id-1').toArray();
    expect(picks.map((p) => [p.id, p.odour_id, p.selected, p.unit_id]).sort()).toEqual([
      ['id-1:mdma', 'mdma', true, 'u1'], ['id-1:tnt', 'tnt', true, 'u1'],
    ]);
    const items = await db.outbox.orderBy('seq').toArray();
    expect(items.map((i) => `${i.table}:${i.op}`)).toEqual(['teams:insert', 'team_odours:insert', 'team_odours:insert']);
    expect(items[0].row).toMatchObject({ id: 'id-1', name: 'Alpha', created_at: '2026-10-03T10:00:00.000Z', planned_dogs: 6 });
  });

  it('is trainers only', async () => {
    await expect(createTeam(ctx(handler), 'Alpha', ['mdma'], 6)).rejects.toBeInstanceOf(NotAllowedError);
    expect(await db.teams.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('needs a name and at least one odour that exists and is not archived', async () => {
    await expect(createTeam(ctx(trainer), '   ', ['mdma'], 6)).rejects.toThrow(/name/i);
    await expect(createTeam(ctx(trainer), 'Alpha', [], 6)).rejects.toThrow(/at least one odour/i);
    await expect(createTeam(ctx(trainer), 'Alpha', ['nope'], 6)).rejects.toThrow(/odour/i);
    await db.odours.update('tnt', { archived_at: '2026-10-02T00:00:00Z' });
    await expect(createTeam(ctx(trainer), 'Alpha', ['mdma', 'tnt'], 6)).rejects.toThrow(/odour/i);
    expect(await db.teams.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0); // nothing half-written
  });

  it('keeps the planned number of dogs in the store and in the queued insert', async () => {
    const t = await createTeam(ctx(trainer), 'Alpha', ['mdma'], 12);
    expect(t.planned_dogs).toBe(12);
    expect((await db.teams.get(t.id))!.planned_dogs).toBe(12);
    expect((await db.outbox.orderBy('seq').first())!.row.planned_dogs).toBe(12);
  });

  it('needs a planned number of dogs: a whole number, 1 or more', async () => {
    const bad: unknown[] = [undefined, null, 0, -1, -12, 2.5, 0.5, NaN, Infinity, -Infinity, '3', '', ' ', 'abc', true, [], {}, 2 ** 31, Number.MAX_SAFE_INTEGER + 2];
    for (const n of bad) {
      await expect(createTeam(ctx(trainer), 'Alpha', ['mdma'], n as number), String(n)).rejects.toThrow('Enter a whole number, 1 or more.');
    }
    expect(await db.teams.count()).toBe(0);
    expect(await db.team_odours.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0); // nothing half-written
  });

  it('accepts 1 and the largest number the database column holds', async () => {
    expect((await createTeam(ctx(trainer), 'Alpha', ['mdma'], 1)).planned_dogs).toBe(1);
    expect((await createTeam(ctx(trainer), 'Bravo', ['mdma'], 2 ** 31 - 1)).planned_dogs).toBe(2 ** 31 - 1);
  });

  it('a handler is turned away before anything else is looked at', async () => {
    await expect(createTeam(ctx(handler), 'Alpha', ['mdma'], 0)).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('refuses another unit\'s odour', async () => {
    await db.odours.put({ ...(await db.odours.get('mdma'))!, id: 'x-mdma', unit_id: 'u2' });
    await expect(createTeam(ctx(trainer), 'Alpha', ['x-mdma'], 6)).rejects.toThrow(/odour/i);
  });
});

describe('setTeamPlannedDogs', () => {
  beforeEach(async () => {
    await db.teams.put(team('t1', 'Alpha')); // a team from before the column: no planned size
    await db.teams.put({ ...team('t2', 'Bravo'), planned_dogs: 6 });
  });

  it('gives a team a size, or changes it: a one-field update through the outbox', async () => {
    await setTeamPlannedDogs(ctx(trainer), 't1', 4);
    await setTeamPlannedDogs(ctx(trainer), 't2', 8);
    expect((await db.teams.get('t1'))!.planned_dogs).toBe(4);
    expect((await db.teams.get('t2'))!.planned_dogs).toBe(8);
    const items = await db.outbox.orderBy('seq').toArray();
    expect(items.map((i) => [i.table, i.op, i.row])).toEqual([
      ['teams', 'update', { id: 't1', planned_dogs: 4 }],
      ['teams', 'update', { id: 't2', planned_dogs: 8 }],
    ]);
  });

  it('is trainers only', async () => {
    await expect(setTeamPlannedDogs(ctx(handler), 't2', 8)).rejects.toBeInstanceOf(NotAllowedError);
    expect((await db.teams.get('t2'))!.planned_dogs).toBe(6);
    expect(await db.outbox.count()).toBe(0);
  });

  it('needs a whole number, 1 or more, and changes nothing otherwise', async () => {
    const bad: unknown[] = [undefined, null, 0, -1, 2.5, NaN, Infinity, '3', '', 'abc', 2 ** 31];
    for (const n of bad) {
      await expect(setTeamPlannedDogs(ctx(trainer), 't2', n as number), String(n)).rejects.toThrow('Enter a whole number, 1 or more.');
    }
    expect((await db.teams.get('t2'))!.planned_dogs).toBe(6);
    expect(await db.outbox.count()).toBe(0);
  });

  it('refuses a team that is not in this unit', async () => {
    await expect(setTeamPlannedDogs(ctx(trainer), 'nope', 5)).rejects.toThrow(/not found/i);
    await db.teams.put(team('x1', 'Xray', null, 'u2'));
    await expect(setTeamPlannedDogs(ctx(trainer), 'x1', 5)).rejects.toThrow(/not found/i);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('renameTeam, archiveTeam, restoreTeam', () => {
  beforeEach(async () => {
    await db.teams.put(team('t1', 'Alpha'));
    await db.dogs.put(dogRow('d1', 'Rex'));
  });

  it('renames: a one-field update through the outbox, trainers only', async () => {
    await renameTeam(ctx(trainer), 't1', ' Bravo ');
    expect((await db.teams.get('t1'))!.name).toBe('Bravo');
    expect((await db.outbox.toArray())[0]).toMatchObject({ table: 'teams', op: 'update', row: { id: 't1', name: 'Bravo' } });
    await expect(renameTeam(ctx(handler), 't1', 'X')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(renameTeam(ctx(trainer), 't1', '  ')).rejects.toThrow(/name/i);
    await expect(renameTeam(ctx(trainer), 'nope', 'X')).rejects.toThrow(/not found/i);
  });

  it('archives and restores, offline-capable (outbox only), trainers only', async () => {
    await archiveTeam(ctx(trainer), 't1');
    expect((await db.teams.get('t1'))!.archived_at).toBe('2026-10-03T10:00:00.000Z');
    await restoreTeam(ctx(trainer), 't1');
    expect((await db.teams.get('t1'))!.archived_at).toBeNull();
    expect(await outbox()).toEqual(['teams:update:t1', 'teams:update:t1']);
    await expect(archiveTeam(ctx(handler), 't1')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(restoreTeam(ctx(handler), 't1')).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('refuses to archive while a dog of the team has a running timer', async () => {
    await seedCatalogue(db, ['t1']);
    await startSession(ctx(handler), 'd1', 'mdma');
    await expect(archiveTeam(ctx(trainer), 't1')).rejects.toThrow(/running timer/i);
    expect((await db.teams.get('t1'))!.archived_at).toBeNull();
  });

  it('a timer on a dog of another team does not block it', async () => {
    await seedCatalogue(db, ['t1', 't2']);
    await db.dogs.put(dogRow('d2', 'Fly', { team_id: 't2' }));
    await startSession(ctx(handler), 'd2', 'mdma');
    await archiveTeam(ctx(trainer), 't1');
    expect((await db.teams.get('t1'))!.archived_at).not.toBeNull();
  });
});

describe('setTeamOdours', () => {
  beforeEach(async () => {
    await db.teams.put(team('t1', 'Alpha'));
    await db.team_odours.bulkPut([pick('t1', 'mdma'), pick('t1', 'tnt')]);
  });

  it('flips only what changed: a new tick is an insert, an untick an update to selected=false', async () => {
    await setTeamOdours(ctx(trainer), 't1', ['mdma', 'cocaine']);
    const rows = Object.fromEntries((await db.team_odours.where('team_id').equals('t1').toArray()).map((r) => [r.odour_id, r.selected]));
    expect(rows).toEqual({ mdma: true, tnt: false, cocaine: true });
    const items = await db.outbox.orderBy('seq').toArray();
    expect(items.map((i) => `${i.op}:${i.row.id}`).sort()).toEqual(['insert:t1:cocaine', 'update:t1:tnt']);
    // full rows, so the server can upsert them whichever op they are
    expect(items.find((i) => i.row.id === 't1:tnt')!.row).toEqual({ id: 't1:tnt', team_id: 't1', odour_id: 'tnt', unit_id: 'u1', selected: false });
  });

  it('never deletes a row, and writes nothing when nothing changed', async () => {
    await setTeamOdours(ctx(trainer), 't1', ['cocaine']);
    expect(await db.team_odours.where('team_id').equals('t1').count()).toBe(3);
    await db.outbox.clear();
    await setTeamOdours(ctx(trainer), 't1', ['cocaine']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('ticking an unticked odour again updates its row', async () => {
    await setTeamOdours(ctx(trainer), 't1', ['mdma']); // tnt off
    await db.outbox.clear();
    await setTeamOdours(ctx(trainer), 't1', ['mdma', 'tnt']);
    expect(await outbox()).toEqual(['team_odours:update:t1:tnt']);
    expect((await db.team_odours.get('t1:tnt'))!.selected).toBe(true);
  });

  it('leaves the choice for an archived odour alone, so a restore brings it back', async () => {
    await db.odours.update('tnt', { archived_at: '2026-10-02T00:00:00Z' });
    await setTeamOdours(ctx(trainer), 't1', ['mdma', 'cocaine']);
    expect((await db.team_odours.get('t1:tnt'))!.selected).toBe(true);
  });

  it('needs one odour at least, only known unarchived ones, an existing team, and a trainer', async () => {
    await expect(setTeamOdours(ctx(trainer), 't1', [])).rejects.toThrow(/at least one odour/i);
    await expect(setTeamOdours(ctx(trainer), 't1', ['nope'])).rejects.toThrow(/odour/i);
    await db.odours.update('heroin', { archived_at: '2026-10-02T00:00:00Z' });
    await expect(setTeamOdours(ctx(trainer), 't1', ['heroin'])).rejects.toThrow(/odour/i);
    await expect(setTeamOdours(ctx(trainer), 'nope', ['mdma'])).rejects.toThrow(/not found/i);
    await expect(setTeamOdours(ctx(handler), 't1', ['mdma'])).rejects.toBeInstanceOf(NotAllowedError);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('dogs: addDog, editDog, moveDog', () => {
  beforeEach(async () => {
    await db.teams.bulkPut([team('t1', 'Alpha'), team('t2', 'Bravo'), team('t3', 'Old', '2026-10-01T00:00:00Z'), team('tx', 'Foreign', null, 'u2')]);
  });

  it('adds a dog to a team with breed and purpose; trainers only', async () => {
    const dog = await addDog(ctx(trainer), '  Rex ', 't1', 'malinois', 'dual');
    expect(dog).toMatchObject({ name: 'Rex', team_id: 't1', breed: 'malinois', purpose: 'dual', unit_id: 'u1', created_by: 'mT', archived_at: null });
    expect((await db.outbox.toArray())[0]).toMatchObject({ table: 'dogs', op: 'insert', row: { id: dog.id, team_id: 't1', breed: 'malinois', purpose: 'dual' } });
    await expect(addDog(ctx(handler), 'Max', 't1', 'other', 'single')).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('needs a name, a real active team of the unit, a breed from the list and a purpose', async () => {
    await expect(addDog(ctx(trainer), ' ', 't1', 'other', 'single')).rejects.toThrow(/name/i);
    await expect(addDog(ctx(trainer), 'Rex', 'nope', 'other', 'single')).rejects.toThrow(/team/i);
    await expect(addDog(ctx(trainer), 'Rex', 't3', 'other', 'single')).rejects.toThrow(/archived/i);
    await expect(addDog(ctx(trainer), 'Rex', 'tx', 'other', 'single')).rejects.toThrow(/team/i);
    await expect(addDog(ctx(trainer), 'Rex', 't1', 'poodle' as never, 'single')).rejects.toThrow(/breed/i);
    await expect(addDog(ctx(trainer), 'Rex', 't1', 'other', 'triple' as never)).rejects.toThrow(/purpose/i);
    expect(await db.dogs.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('edits name, breed and purpose, sending only the changed fields', async () => {
    await db.dogs.put(dogRow('d1', 'Rex', { breed: 'labrador', purpose: 'single' }));
    await editDog(ctx(trainer), 'd1', { name: ' Rexy ', breed: 'hound' });
    expect(await db.dogs.get('d1')).toMatchObject({ name: 'Rexy', breed: 'hound', purpose: 'single' });
    expect((await db.outbox.toArray())[0].row).toEqual({ id: 'd1', name: 'Rexy', breed: 'hound' });
    await expect(editDog(ctx(handler), 'd1', { name: 'X' })).rejects.toBeInstanceOf(NotAllowedError);
    await expect(editDog(ctx(trainer), 'd1', { name: ' ' })).rejects.toThrow(/name/i);
    await expect(editDog(ctx(trainer), 'd1', { breed: 'poodle' as never })).rejects.toThrow(/breed/i);
    await expect(editDog(ctx(trainer), 'd1', { purpose: 'x' as never })).rejects.toThrow(/purpose/i);
    await expect(editDog(ctx(trainer), 'nope', { name: 'X' })).rejects.toThrow(/not found/i);
  });

  it('renameDog still renames', async () => {
    await db.dogs.put(dogRow('d1', 'Rex'));
    await renameDog(ctx(trainer), 'd1', 'Rexy');
    expect((await db.dogs.get('d1'))!.name).toBe('Rexy');
  });

  it('moves a dog to another active team of the unit', async () => {
    await db.dogs.put(dogRow('d1', 'Rex'));
    await moveDog(ctx(trainer), 'd1', 't2');
    expect((await db.dogs.get('d1'))!.team_id).toBe('t2');
    expect((await db.outbox.toArray())[0].row).toEqual({ id: 'd1', team_id: 't2' });
    await db.outbox.clear();
    await moveDog(ctx(trainer), 'd1', 't2'); // already there: nothing to send
    expect(await db.outbox.count()).toBe(0);
  });

  it('refuses to move to an archived, unknown or foreign team, and for a handler', async () => {
    await db.dogs.put(dogRow('d1', 'Rex'));
    await expect(moveDog(ctx(trainer), 'd1', 't3')).rejects.toThrow(/archived/i);
    await expect(moveDog(ctx(trainer), 'd1', 'nope')).rejects.toThrow(/team/i);
    await expect(moveDog(ctx(trainer), 'd1', 'tx')).rejects.toThrow(/team/i);
    await expect(moveDog(ctx(handler), 'd1', 't2')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(moveDog(ctx(trainer), 'nope', 't2')).rejects.toThrow(/not found/i);
    expect((await db.dogs.get('d1'))!.team_id).toBe('t1');
  });
});

describe('sessions use catalogue ids', () => {
  it('start refuses an odour that is not in the local catalogue', async () => {
    await db.teams.put(team('t1', 'Alpha'));
    await db.dogs.put(dogRow('d1', 'Rex'));
    await expect(startSession(ctx(handler), 'd1', 'not-an-odour')).rejects.toThrow(/odour/i);
    expect(await db.sessions.count()).toBe(0);
    const s = await startSession(ctx(handler), 'd1', 'mdma');
    expect(s.odour_id).toBe('mdma');
  });
});
