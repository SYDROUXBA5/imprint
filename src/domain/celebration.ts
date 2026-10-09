import { IMPRINT_TARGET_S } from './totals';

export const crossedTarget = (prevS: number, nextS: number): boolean =>
  prevS < IMPRINT_TARGET_S && nextS >= IMPRINT_TARGET_S;
