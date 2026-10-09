import type { Session } from './types';

export const CLOCK_CHECK_LIMIT_S = 600;

export const needsClockCheck = (s: Session): boolean =>
  s.client_clock_offset_s !== null && Math.abs(s.client_clock_offset_s) > CLOCK_CHECK_LIMIT_S;

export function overlappingSessionIds(sessions: Session[], nowMs: number): Set<string> {
  const flagged = new Set<string>();
  const byDog = new Map<string, { id: string; start: number; end: number }[]>();
  for (const s of sessions) {
    if (s.kind !== 'timed' || !s.started_at) continue;
    const list = byDog.get(s.dog_id) ?? [];
    list.push({
      id: s.id,
      start: Date.parse(s.started_at),
      end: s.ended_at ? Date.parse(s.ended_at) : nowMs,
    });
    byDog.set(s.dog_id, list);
  }
  for (const list of byDog.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.start < b.end && b.start < a.end) {
          flagged.add(a.id);
          flagged.add(b.id);
        }
      }
    }
  }
  return flagged;
}
