// A team's planned number of dogs: how many dogs the team will hold. A plan only, it never creates dogs.

/** What the sheet and the actions say about a bad number. */
export const PLANNED_DOGS_MESSAGE = 'Enter a whole number, 1 or more.';

/** The database column is an integer: a bigger number could never be stored, and would stick in the outbox. */
const MAX_PLANNED_DOGS = 2_147_483_647;

/** A whole number, 1 or more, that the column can hold. */
export const isPlannedDogs = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PLANNED_DOGS;

/** Throws the same message the sheet shows unless `n` is a valid planned number of dogs. */
export function requirePlannedDogs(n: unknown): number {
  if (!isPlannedDogs(n)) throw new Error(PLANNED_DOGS_MESSAGE);
  return n;
}

/**
 * What someone typed in the field: digits only (surrounding spaces are fine), at least 1. Anything else,
 * including empty, a minus sign, a decimal point or letters, is null.
 */
export function parsePlannedDogs(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return isPlannedDogs(n) ? n : null;
}
