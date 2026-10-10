import { IMPRINT_TARGET_S, currentDuration } from '../domain/totals';
import type { Correction, Session } from '../domain/types';

/**
 * When one dog became imprinted on one odour: the date of the session that took the running total
 * (current durations, in date order) to 75:00. Pass the sessions of that one dog and odour.
 * Null if the total is not there now, so a correction that takes it back under 75:00 removes the date.
 */
export function imprintedDate(sessions: Session[], corrections: Correction[]): string | null {
  // Calendar date first, then start time (a manual session has none, so it comes first that day).
  const ordered = [...sessions].sort((a, b) =>
    a.session_date.localeCompare(b.session_date) ||
    (a.started_at ?? '').localeCompare(b.started_at ?? '') ||
    a.id.localeCompare(b.id));
  let total = 0;
  for (const s of ordered) {
    total += currentDuration(s, corrections);
    if (total >= IMPRINT_TARGET_S) return s.session_date;
  }
  return null;
}
