import { formatMinutesOfTarget } from './format';
import { odourById } from './odours';
import type { Correction, Session } from './types';
import { currentDuration, isImprinted, isRunning, odourTotal } from './totals';

export interface TrainedOdour { odourId: string; name: string; totalS: number; lastKey: string }

/**
 * Odours a dog has time logged for (or a timer running on), most recently trained first.
 * "Recently" is by day, then by start time within the day (manual entries have no start time).
 */
export function trainedOdours(
  dogId: string, sessions: Session[], corrections: Correction[], nowMs: number,
): TrainedOdour[] {
  const lastKeys = new Map<string, string>();
  const running = new Set<string>();
  for (const s of sessions) {
    if (s.dog_id !== dogId) continue;
    const live = isRunning(s, corrections);
    if (live) running.add(s.odour_id);
    if (!live && currentDuration(s, corrections) === 0) continue; // voided or empty: not "trained"
    const key = `${s.session_date}|${s.started_at ?? ''}`;
    if (key > (lastKeys.get(s.odour_id) ?? '')) lastKeys.set(s.odour_id, key);
  }
  const out: TrainedOdour[] = [];
  for (const odourId of new Set([...lastKeys.keys(), ...running])) {
    const odour = odourById(odourId);
    if (!odour) continue;
    const totalS = odourTotal(sessions, corrections, dogId, odourId, nowMs);
    if (totalS === 0 && !running.has(odourId)) continue;
    out.push({ odourId, name: odour.name, totalS, lastKey: lastKeys.get(odourId) ?? '' });
  }
  return out.sort((a, b) => b.lastKey.localeCompare(a.lastKey) || a.name.localeCompare(b.name));
}

/** e.g. "MDMA 42/75 · Cocaine ✓" */
export function progressLine(dogId: string, sessions: Session[], corrections: Correction[], nowMs: number): string {
  return trainedOdours(dogId, sessions, corrections, nowMs)
    .map((o) => (isImprinted(o.totalS) ? `${o.name} ✓` : `${o.name} ${formatMinutesOfTarget(o.totalS)}`))
    .join(' · ');
}
