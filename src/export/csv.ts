import { breedLabel, purposeLabel } from '../domain/breeds';
import { needsClockCheck, overlappingSessionIds } from '../domain/flags';
import { formatMinSec } from '../domain/format';
import { odourById } from '../domain/odours';
import { currentDuration, latestCorrection } from '../domain/totals';
import type { Correction, Dog, Member, Odour, OdourCategory, Session, Team } from '../domain/types';

export const CSV_HEADER = [
  'dog', 'dog archived', 'team', 'breed', 'purpose', 'category', 'odour', 'handler', 'kind', 'date', 'start', 'end',
  'recorded duration (mm:ss)', 'recorded duration (s)', 'current duration (mm:ss)', 'current duration (s)',
  'voided', 'correction reasons', 'flags',
] as const;

export interface CsvInput {
  /** Every dog, archived ones too. */
  dogs: Dog[];
  /** Names each dog's team; a dog whose team is missing gets a blank. */
  teams: Team[];
  members: Member[];
  sessions: Session[];
  corrections: Correction[];
  /** The odour catalogue, archived rows included: it names each session's odour and its category. */
  odours: Odour[];
  categories: OdourCategory[];
  /** For the overlap check on a timer that is still running. */
  nowMs: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-05 10:12:04" in the phone's own time zone, like the date column. */
function localDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// A cell starting with one of these is read as a formula by Excel and Sheets. Names and reasons are
// typed by users, so those get a leading apostrophe; numbers and dates are written by us and never do.
const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180: quote a field holding a comma, a quote or a line break; double any quotes inside it. */
function cell(value: string, userText = false): string {
  const safe = userText && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * One row per session, archived dogs and voided sessions included. Hand it every dog for the whole unit, or
 * only one team's dogs and their sessions for a team file; the columns are the same either way. UTF-8 with a byte order mark so
 * Excel shows accents; CRLF line ends. Rows run by dog name, then oldest first.
 */
export function sessionsCsv({ dogs, teams, members, sessions, corrections, odours, categories, nowMs }: CsvInput): string {
  const dogById = new Map(dogs.map((d) => [d.id, d]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const isVoided = (s: Session) => latestCorrection(s.id, corrections)?.void === true;
  // A voided session is out of the picture, so it neither is flagged nor flags the one next to it.
  const overlapping = overlappingSessionIds(sessions.filter((s) => !isVoided(s)), nowMs);
  const dogName = (s: Session) => dogById.get(s.dog_id)?.name ?? '';

  const ordered = [...sessions].sort((a, b) =>
    dogName(a).localeCompare(dogName(b), undefined, { sensitivity: 'base' }) ||
    a.session_date.localeCompare(b.session_date) ||
    (a.started_at ?? '').localeCompare(b.started_at ?? '') ||
    a.id.localeCompare(b.id));

  const lines = ordered.map((s) => {
    const dog = dogById.get(s.dog_id);
    const odour = odourById(odours, s.odour_id);
    const mine = corrections.filter((c) => c.session_id === s.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const flags = [overlapping.has(s.id) && 'Overlap', needsClockCheck(s) && 'Clock check'].filter(Boolean).join(' | ');
    const current = currentDuration(s, corrections);
    return [
      cell(dog?.name ?? '', true),
      dog?.archived_at ? 'yes' : 'no',
      cell(dog ? (teamName.get(dog.team_id) ?? '') : '', true),
      dog ? breedLabel(dog.breed) : '',
      dog ? purposeLabel(dog.purpose) : '',
      cell(odour ? (categoryName.get(odour.category_id) ?? '') : '', true),
      cell(odour?.name ?? s.odour_id, true),
      cell(memberName.get(s.handler_id) ?? 'Unknown', true),
      s.kind,
      s.session_date,
      localDateTime(s.started_at),
      localDateTime(s.ended_at),
      s.duration_s === null ? '' : formatMinSec(s.duration_s),
      s.duration_s === null ? '' : String(s.duration_s),
      formatMinSec(current),
      String(current),
      isVoided(s) ? 'yes' : 'no',
      cell(mine.map((c) => c.reason).join(' | '), true),
      flags,
    ].join(',');
  });

  return `﻿${[CSV_HEADER.join(','), ...lines].join('\r\n')}\r\n`;
}
