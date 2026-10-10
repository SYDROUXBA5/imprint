import { teamOdourGroups } from '../domain/odours';
import type { Catalogue, Dog, Odour, Session } from '../domain/types';

/**
 * The odours a dog's report lists: what the dog's team trains on (ticked, and neither the odour nor its
 * category archived), plus any odour the dog has time on that the team no longer trains, so no recorded time
 * goes missing from the report. Order does not matter; the report sorts by category and name.
 */
export function reportOdours(dog: Dog, dogSessions: readonly Session[], catalogue: Catalogue): Odour[] {
  const listed = new Set(teamOdourGroups(dog.team_id, catalogue).flatMap((g) => g.odours.map((o) => o.id)));
  for (const s of dogSessions) listed.add(s.odour_id);
  return catalogue.odours.filter((o) => listed.has(o.id));
}
