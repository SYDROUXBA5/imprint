import type { ImprintDB } from '../data/db';
import { localDate } from '../domain/format';
import type { Me } from '../domain/types';
import { sessionsCsv } from './csv';
import { dogReportPdf, teamReportPdf } from './pdf';
import { reportOdours } from './reportOdours';
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
  const [dogs, teams, members, sessions, corrections, odours, categories, unitName] = await Promise.all([
    db.dogs.toArray(), db.teams.toArray(), db.members.toArray(), db.sessions.toArray(), db.corrections.toArray(),
    db.odours.toArray(), db.odour_categories.toArray(), unitNameOf(db),
  ]);
  const csv = sessionsCsv({ dogs, teams, members, sessions, corrections, odours, categories, nowMs: now.getTime() });
  const filename = `imprint-${slug(unitName, 'unit')}-${localDate(now)}.csv`;
  const outcome = await shareOrDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  return { outcome, filename };
}

/** The team, its dogs (archived ones too), and their sessions and corrections, from what is on this phone. */
async function teamData(db: ImprintDB, teamId: string) {
  const team = await db.teams.get(teamId);
  if (!team) throw new Error('Team not found');
  const dogs = (await db.dogs.toArray()).filter((d) => d.team_id === teamId);
  const sessions = await db.sessions.where('dog_id').anyOf(dogs.map((d) => d.id)).toArray();
  const corrections = await db.corrections.where('session_id').anyOf(sessions.map((s) => s.id)).toArray();
  return { team, dogs, sessions, corrections };
}

/** The all-sessions CSV (same columns), limited to one team's dogs, archived ones included. */
export async function exportTeamCsv(db: ImprintDB, teamId: string, now: Date = new Date()): Promise<ExportDone> {
  const { team, dogs, sessions, corrections } = await teamData(db, teamId);
  const [members, odours, categories] = await Promise.all([db.members.toArray(), db.odours.toArray(), db.odour_categories.toArray()]);
  const csv = sessionsCsv({ dogs, teams: [team], members, sessions, corrections, odours, categories, nowMs: now.getTime() });
  const filename = `imprint-${slug(team.name, 'team')}-${localDate(now)}.csv`;
  const outcome = await shareOrDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  return { outcome, filename };
}

/** One page per active dog of the team (the PDF library loads only now). */
export async function exportTeamReport(db: ImprintDB, me: Me, teamId: string, now: Date = new Date()): Promise<ExportDone> {
  const { team, dogs, sessions, corrections } = await teamData(db, teamId);
  const [categories, odours, teamOdours] = await Promise.all([db.odour_categories.toArray(), db.odours.toArray(), db.team_odours.toArray()]);
  const blob = await teamReportPdf({
    team, unitName: await unitNameOf(db), generatedBy: me.name, generatedAt: now, dogs, sessions, corrections,
    categories, odours, teamOdours: teamOdours.filter((t) => t.team_id === teamId),
  });
  const filename = `imprint-${slug(team.name, 'team')}-${localDate(now)}.pdf`;
  const outcome = await shareOrDownload(blob, filename);
  return { outcome, filename };
}

/** One dog's progress report (the PDF library loads only now). */
export async function exportDogReport(db: ImprintDB, me: Me, dogId: string, now: Date = new Date()): Promise<ExportDone> {
  const dog = await db.dogs.get(dogId);
  if (!dog) throw new Error('Dog not found');
  const sessions = await db.sessions.where('dog_id').equals(dogId).toArray();
  const corrections = await db.corrections.where('session_id').anyOf(sessions.map((s) => s.id)).toArray();
  // The dog's team's odours, plus any odour the dog has time on that the team no longer trains.
  const [categories, odours, teamOdours, team] = await Promise.all([
    db.odour_categories.toArray(), db.odours.toArray(), db.team_odours.toArray(), db.teams.get(dog.team_id),
  ]);
  const blob = await dogReportPdf({
    dog, unitName: await unitNameOf(db), teamName: team?.name, generatedBy: me.name, generatedAt: now, sessions, corrections,
    categories, odours: reportOdours(dog, sessions, { categories, odours, teamOdours }),
  });
  const filename = `imprint-${slug(dog.name, 'dog')}-${localDate(now)}.pdf`;
  const outcome = await shareOrDownload(blob, filename);
  return { outcome, filename };
}
