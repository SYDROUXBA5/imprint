import type { Correction, Session } from './types';

export const IMPRINT_TARGET_S = 75 * 60;

export function latestCorrection(sessionId: string, corrections: Correction[]): Correction | undefined {
  let latest: Correction | undefined;
  for (const c of corrections) {
    if (c.session_id !== sessionId) continue;
    if (!latest || c.created_at > latest.created_at) latest = c;
  }
  return latest;
}

export function isRunning(session: Session, corrections: Correction[]): boolean {
  return (
    session.kind === 'timed' &&
    session.started_at !== null &&
    session.ended_at === null &&
    latestCorrection(session.id, corrections) === undefined
  );
}

export function currentDuration(session: Session, corrections: Correction[]): number {
  const c = latestCorrection(session.id, corrections);
  if (c) return c.void ? 0 : (c.new_duration_s ?? 0);
  return session.duration_s ?? 0;
}

export function liveElapsed(session: Session, corrections: Correction[], nowMs: number): number {
  if (!isRunning(session, corrections)) return 0;
  return Math.max(0, Math.floor((nowMs - Date.parse(session.started_at!)) / 1000));
}

export function odourTotal(
  sessions: Session[], corrections: Correction[],
  dogId: string, odourId: string, nowMs?: number,
): number {
  let total = 0;
  for (const s of sessions) {
    if (s.dog_id !== dogId || s.odour_id !== odourId) continue;
    total += currentDuration(s, corrections);
    if (nowMs !== undefined) total += liveElapsed(s, corrections, nowMs);
  }
  return total;
}

export const isImprinted = (totalS: number): boolean => totalS >= IMPRINT_TARGET_S;
