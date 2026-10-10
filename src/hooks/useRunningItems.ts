import { useMemo } from 'react';
import { odourName } from '../domain/odours';
import { isRunning } from '../domain/totals';
import type { Correction, Dog, Member, Odour, Session } from '../domain/types';
import type { RunningItem } from '../ui/components/RunningBanner';

/** Timers running right now on the given dogs, oldest first (the banner's rows). */
export function useRunningItems(
  dogs: readonly Dog[], members: readonly Member[], odours: readonly Odour[],
  sessions: Session[], corrections: Correction[],
): RunningItem[] {
  return useMemo(() => {
    const names = new Map(members.map((m) => [m.id, m.name]));
    const dogNames = new Map(dogs.map((d) => [d.id, d.name]));
    const items: RunningItem[] = [];
    for (const s of sessions) {
      if (!isRunning(s, corrections) || !dogNames.has(s.dog_id)) continue;
      items.push({
        dog: dogNames.get(s.dog_id)!, odour: odourName(odours, s.odour_id),
        handler: names.get(s.handler_id) ?? 'Someone', startedAt: s.started_at!,
      });
    }
    return items.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [dogs, members, odours, sessions, corrections]);
}

/** Ids of the teams that have a timer running on one of the given dogs. */
export function useRunningTeamIds(
  dogs: readonly Dog[], sessions: Session[], corrections: Correction[],
): Set<string> {
  return useMemo(() => {
    const teamOf = new Map(dogs.map((d) => [d.id, d.team_id]));
    const ids = new Set<string>();
    for (const s of sessions) {
      const teamId = teamOf.get(s.dog_id);
      if (teamId !== undefined && isRunning(s, corrections)) ids.add(teamId);
    }
    return ids;
  }, [dogs, sessions, corrections]);
}
