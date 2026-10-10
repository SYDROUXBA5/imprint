import type { ImprintDB } from '../data/db';
import { localDate } from '../domain/format';
import { teamOdourGroups } from '../domain/odours';
import type { Member } from '../domain/types';
import { sessionsCsv } from './csv';
import { dogReportPdf } from './pdf';
import { shareOrDownload, type ShareOutcome } from './share';

export interface ExportDone {
  outcome: ShareOutcome;
  filename: string;
}

/** "Border K9" -> "border-k9", "Zoë's dog" -> "zoe-s-dog": safe in a file name on any phone. */
export function slug(name: string, fallback: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}

const unitNameOf = async (db: ImprintDB) => (await db.units.toCollection().first())?.name ?? 'unit';

/** Every session of the unit, archived dogs included, from what is on this phone. */
export async function exportAllSessionsCsv(db: ImprintDB, now: Date = new Date()): Promise<ExportDone> {
  const [dogs, members, sessions, corrections, odours, categories, unitName] = await Promise.all([
    db.dogs.toArray(), db.members.toArray(), db.sessions.toArray(), db.corrections.toArray(),
    db.odours.toArray(), db.odour_categories.toArray(), unitNameOf(db),
  ]);
  const csv = sessionsCsv({ dogs, members, sessions, corrections, odours, categories, nowMs: now.getTime() });
  const filename = `imprint-${slug(unitName, 'unit')}-${localDate(now)}.csv`;
  const outcome = await shareOrDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  return { outcome, filename };
}

/** One dog's progress report (the PDF library loads only now). */
export async function exportDogReport(db: ImprintDB, me: Member, dogId: string, now: Date = new Date()): Promise<ExportDone> {
  const dog = await db.dogs.get(dogId);
  if (!dog) throw new Error('Dog not found');
  const sessions = await db.sessions.where('dog_id').equals(dogId).toArray();
  const corrections = await db.corrections.where('session_id').anyOf(sessions.map((s) => s.id)).toArray();
  // The dog's team's odours, plus any odour the dog has time on that the team no longer trains.
  const [categories, odours, teamOdours] = await Promise.all([
    db.odour_categories.toArray(), db.odours.toArray(), db.team_odours.toArray(),
  ]);
  const listed = new Set(teamOdourGroups(dog.team_id, { categories, odours, teamOdours }).flatMap((g) => g.odours.map((o) => o.id)));
  for (const s of sessions) listed.add(s.odour_id);
  const blob = await dogReportPdf({
    dog, unitName: await unitNameOf(db), generatedBy: me.name, generatedAt: now, sessions, corrections,
    categories, odours: odours.filter((o) => listed.has(o.id)),
  });
  const filename = `imprint-${slug(dog.name, 'dog')}-${localDate(now)}.pdf`;
  const outcome = await shareOrDownload(blob, filename);
  return { outcome, filename };
}
