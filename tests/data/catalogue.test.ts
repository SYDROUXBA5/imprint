import { beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicateNameError, addCategory, addOdour, archiveCategory, archiveOdour,
  renameCategory, renameOdour, restoreCategory, restoreOdour,
} from '../../src/data/catalogue';
import { ImprintDB } from '../../src/data/db';
import { NotAllowedError, type Ctx } from '../../src/data/repo';
import type { Member } from '../../src/domain/types';
import { seedCatalogue } from '../fixtures';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { ...trainer, id: 'mH', user_id: 'uH', name: 'Paul', role: 'handler' };

let db: ImprintDB;
let n = 0;
const ctx = (me: Member): Ctx => ({ db, me, now: () => new Date('2026-10-03T10:00:00.000Z'), uuid: () => `id-${++n}` });

beforeEach(async () => {
  db = new ImprintDB(`catalogue-${Math.random()}`);
  n = 0;
  await seedCatalogue(db, []);
});

describe('categories', () => {
  it('adds one at the end of the order, and trims the name', async () => {
    const c = await addCategory(ctx(trainer), '  Currency ');
    expect(c).toMatchObject({ id: 'id-1', unit_id: 'u1', name: 'Currency', sort: 5, archived_at: null, created_at: '2026-10-03T10:00:00.000Z' });
    expect(await db.odour_categories.get('id-1')).toBeDefined();
    expect((await db.outbox.toArray())[0]).toMatchObject({ table: 'odour_categories', op: 'insert', row: { id: 'id-1', name: 'Currency', sort: 5 } });
  });

  it('is trainers only, and needs a name', async () => {
    await expect(addCategory(ctx(handler), 'Currency')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(addCategory(ctx(trainer), '   ')).rejects.toThrow(/name/i);
    expect(await db.outbox.count()).toBe(0);
  });

  it('refuses a duplicate name, ignoring case and spaces, archived categories included', async () => {
    await expect(addCategory(ctx(trainer), 'narcotics')).rejects.toBeInstanceOf(DuplicateNameError);
    await expect(addCategory(ctx(trainer), ' BED BUGS ')).rejects.toThrow('There is already a category called "Bed bugs".');
    await db.odour_categories.update('cadaver', { archived_at: '2026-10-02T00:00:00Z' });
    await expect(addCategory(ctx(trainer), 'Cadaver')).rejects.toThrow(/archived/i);
    expect(await db.outbox.count()).toBe(0);
  });

  it('renames, allowing a change of case on itself but not another category\'s name', async () => {
    await renameCategory(ctx(trainer), 'narcotics', 'NARCOTICS');
    expect((await db.odour_categories.get('narcotics'))!.name).toBe('NARCOTICS');
    await expect(renameCategory(ctx(trainer), 'narcotics', 'explosives')).rejects.toBeInstanceOf(DuplicateNameError);
    await expect(renameCategory(ctx(handler), 'narcotics', 'X')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(renameCategory(ctx(trainer), 'narcotics', ' ')).rejects.toThrow(/name/i);
    await expect(renameCategory(ctx(trainer), 'nope', 'X')).rejects.toThrow(/not found/i);
  });

  it('archives and restores, keeping its odours as they are', async () => {
    await archiveCategory(ctx(trainer), 'explosives');
    expect((await db.odour_categories.get('explosives'))!.archived_at).toBe('2026-10-03T10:00:00.000Z');
    expect((await db.odours.get('tnt'))!.archived_at).toBeNull();
    await restoreCategory(ctx(trainer), 'explosives');
    expect((await db.odour_categories.get('explosives'))!.archived_at).toBeNull();
    expect((await db.outbox.toArray()).map((i) => [i.table, i.op, i.row.id])).toEqual([
      ['odour_categories', 'update', 'explosives'], ['odour_categories', 'update', 'explosives'],
    ]);
    await expect(archiveCategory(ctx(handler), 'explosives')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(restoreCategory(ctx(handler), 'explosives')).rejects.toBeInstanceOf(NotAllowedError);
  });
});

describe('odours', () => {
  it('adds one to a category', async () => {
    const o = await addOdour(ctx(trainer), 'narcotics', ' Ketamine ');
    expect(o).toMatchObject({ id: 'id-1', unit_id: 'u1', category_id: 'narcotics', name: 'Ketamine', archived_at: null });
    expect((await db.outbox.toArray())[0]).toMatchObject({ table: 'odours', op: 'insert', row: { id: 'id-1', category_id: 'narcotics' } });
  });

  it('is trainers only, needs a name and a category that exists and is not archived', async () => {
    await expect(addOdour(ctx(handler), 'narcotics', 'Ketamine')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(addOdour(ctx(trainer), 'narcotics', ' ')).rejects.toThrow(/name/i);
    await expect(addOdour(ctx(trainer), 'nope', 'Ketamine')).rejects.toThrow(/not found/i);
    await db.odour_categories.update('cadaver', { archived_at: '2026-10-02T00:00:00Z' });
    await expect(addOdour(ctx(trainer), 'cadaver', 'Bone')).rejects.toThrow(/archived/i);
    expect(await db.outbox.count()).toBe(0);
  });

  it('refuses a duplicate within the category, archived odours included, but allows it in another category', async () => {
    await expect(addOdour(ctx(trainer), 'narcotics', 'cocaine')).rejects.toBeInstanceOf(DuplicateNameError);
    await expect(addOdour(ctx(trainer), 'narcotics', ' MDMA ')).rejects.toThrow('There is already an odour called "MDMA" in Narcotics.');
    await db.odours.update('heroin', { archived_at: '2026-10-02T00:00:00Z' });
    await expect(addOdour(ctx(trainer), 'narcotics', 'Heroin')).rejects.toThrow(/archived/i);
    await addOdour(ctx(trainer), 'explosives', 'Cocaine'); // a different category: fine
    expect((await db.odours.toArray()).filter((o) => o.name === 'Cocaine')).toHaveLength(2);
  });

  it('renames within its category', async () => {
    await renameOdour(ctx(trainer), 'mdma', 'Ecstasy');
    expect((await db.odours.get('mdma'))!.name).toBe('Ecstasy');
    expect((await db.outbox.toArray())[0].row).toEqual({ id: 'mdma', name: 'Ecstasy' });
    await renameOdour(ctx(trainer), 'mdma', 'ECSTASY'); // own name, other case
    await expect(renameOdour(ctx(trainer), 'mdma', 'cocaine')).rejects.toBeInstanceOf(DuplicateNameError);
    await expect(renameOdour(ctx(handler), 'mdma', 'X')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(renameOdour(ctx(trainer), 'nope', 'X')).rejects.toThrow(/not found/i);
  });

  it('archives and restores', async () => {
    await archiveOdour(ctx(trainer), 'tnt');
    expect((await db.odours.get('tnt'))!.archived_at).toBe('2026-10-03T10:00:00.000Z');
    await restoreOdour(ctx(trainer), 'tnt');
    expect((await db.odours.get('tnt'))!.archived_at).toBeNull();
    await expect(archiveOdour(ctx(handler), 'tnt')).rejects.toBeInstanceOf(NotAllowedError);
    await expect(restoreOdour(ctx(handler), 'tnt')).rejects.toBeInstanceOf(NotAllowedError);
  });
});
