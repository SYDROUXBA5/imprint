import { IMPRINT_TARGET_S } from '../../domain/totals';

/** Whole percent of the 75-minute target, capped at 100. Floors, so 74:59 is 99, never 100. */
export const percentOfTarget = (totalS: number): number =>
  Math.min(100, Math.floor((Math.max(0, totalS) * 100) / IMPRINT_TARGET_S));
