// Odour catalogue actions (spec §13.4): categories and the odours in them. Trainers only, offline-capable
// like the dog actions. "Remove" is archive: nothing with history is ever hard-deleted. Names are unique
// per unit, ignoring case (categories) and per category (odours); archived names still count, so restoring
// never collides with a newer namesake. The database has the same unique indexes.
import type { Odour, OdourCategory } from '../domain/types';
import { cleanName, idOf, nowOf, requireTrainer, writeAll, type Ctx } from './repo';

/** The name is taken. `message` says what to do about it. */
export class DuplicateNameError extends Error {}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function requireCategory(c: Ctx, id: string): Promise<OdourCategory> {
  const cat = await c.db.odour_categories.get(id);
  if (!cat || cat.unit_id !== c.me.unit_id) throw new Error('Category not found');
  return cat;
}

async function requireOdour(c: Ctx, id: string): Promise<Odour> {
  const odour = await c.db.odours.get(id);
  if (!odour || odour.unit_id !== c.me.unit_id) throw new Error('Odour not found');
  return odour;
}

async function checkCategoryName(c: Ctx, name: string, selfId?: string): Promise<void> {
  const clash = (await c.db.odour_categories.where('unit_id').equals(c.me.unit_id).toArray())
    .find((x) => x.id !== selfId && same(x.name, name));
  if (clash) {
    throw new DuplicateNameError(clash.archived_at
      ? `There is already an archived category called "${clash.name}". Restore it instead.`
      : `There is already a category called "${clash.name}".`);
  }
}

async function checkOdourName(c: Ctx, category: OdourCategory, name: string, selfId?: string): Promise<void> {
  const clash = (await c.db.odours.where('category_id').equals(category.id).toArray())
    .find((x) => x.id !== selfId && same(x.name, name));
  if (clash) {
    throw new DuplicateNameError(clash.archived_at
      ? `There is already an archived odour called "${clash.name}" in ${category.name}. Restore it instead.`
      : `There is already an odour called "${clash.name}" in ${category.name}.`);
  }
}

/** Goes at the end of the order. */
export async function addCategory(c: Ctx, name: string): Promise<OdourCategory> {
  requireTrainer(c);
  const clean = cleanName(name, 'Category');
  await checkCategoryName(c, clean);
  const mine = await c.db.odour_categories.where('unit_id').equals(c.me.unit_id).toArray();
  const category: OdourCategory = {
    id: idOf(c), unit_id: c.me.unit_id, name: clean, sort: Math.max(0, ...mine.map((x) => x.sort)) + 1,
    created_at: nowOf(c).toISOString(), archived_at: null,
  };
  await writeAll(c, [{ table: 'odour_categories', op: 'insert', row: { ...category } }]);
  return category;
}

export async function renameCategory(c: Ctx, id: string, name: string): Promise<void> {
  requireTrainer(c);
  const clean = cleanName(name, 'Category');
  await requireCategory(c, id);
  await checkCategoryName(c, clean, id);
  await writeAll(c, [{ table: 'odour_categories', op: 'update', row: { id, name: clean } }]);
}

/** Hides the category and, with it, its odours from the pickers. Their own flags are not touched. */
export async function archiveCategory(c: Ctx, id: string): Promise<void> {
  requireTrainer(c);
  await requireCategory(c, id);
  await writeAll(c, [{ table: 'odour_categories', op: 'update', row: { id, archived_at: nowOf(c).toISOString() } }]);
}

export async function restoreCategory(c: Ctx, id: string): Promise<void> {
  requireTrainer(c);
  await requireCategory(c, id);
  await writeAll(c, [{ table: 'odour_categories', op: 'update', row: { id, archived_at: null } }]);
}

export async function addOdour(c: Ctx, categoryId: string, name: string): Promise<Odour> {
  requireTrainer(c);
  const clean = cleanName(name, 'Odour');
  const category = await requireCategory(c, categoryId);
  if (category.archived_at) throw new Error(`${category.name} is archived. Restore it first.`);
  await checkOdourName(c, category, clean);
  const odour: Odour = {
    id: idOf(c), unit_id: c.me.unit_id, category_id: categoryId, name: clean,
    created_at: nowOf(c).toISOString(), archived_at: null,
  };
  await writeAll(c, [{ table: 'odours', op: 'insert', row: { ...odour } }]);
  return odour;
}

export async function renameOdour(c: Ctx, id: string, name: string): Promise<void> {
  requireTrainer(c);
  const clean = cleanName(name, 'Odour');
  const odour = await requireOdour(c, id);
  await checkOdourName(c, await requireCategory(c, odour.category_id), clean, id);
  await writeAll(c, [{ table: 'odours', op: 'update', row: { id, name: clean } }]);
}

export async function archiveOdour(c: Ctx, id: string): Promise<void> {
  requireTrainer(c);
  await requireOdour(c, id);
  await writeAll(c, [{ table: 'odours', op: 'update', row: { id, archived_at: nowOf(c).toISOString() } }]);
}

export async function restoreOdour(c: Ctx, id: string): Promise<void> {
  requireTrainer(c);
  await requireOdour(c, id);
  await writeAll(c, [{ table: 'odours', op: 'update', row: { id, archived_at: null } }]);
}
