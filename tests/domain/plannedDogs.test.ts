import { describe, expect, it } from 'vitest';
import { PLANNED_DOGS_MESSAGE, isPlannedDogs, parsePlannedDogs, requirePlannedDogs } from '../../src/domain/plannedDogs';

describe('isPlannedDogs / requirePlannedDogs', () => {
  it('accepts whole numbers from 1 up to what the column holds', () => {
    for (const n of [1, 2, 6, 40, 2 ** 31 - 1]) {
      expect(isPlannedDogs(n), String(n)).toBe(true);
      expect(requirePlannedDogs(n)).toBe(n);
    }
  });

  it('refuses everything else with the one message', () => {
    for (const n of [0, -1, 1.5, NaN, Infinity, 2 ** 31, '6', '', null, undefined, true, {}]) {
      expect(isPlannedDogs(n), String(n)).toBe(false);
      expect(() => requirePlannedDogs(n), String(n)).toThrow(PLANNED_DOGS_MESSAGE);
    }
    expect(PLANNED_DOGS_MESSAGE).toBe('Enter a whole number, 1 or more.');
  });
});

describe('parsePlannedDogs', () => {
  it('reads digits, ignoring spaces around them', () => {
    expect(parsePlannedDogs('6')).toBe(6);
    expect(parsePlannedDogs(' 12 ')).toBe(12);
    expect(parsePlannedDogs('007')).toBe(7);
    expect(parsePlannedDogs('1')).toBe(1);
  });

  it('gives null for empty, zero, negative, decimal, other characters and too big', () => {
    for (const t of ['', '   ', '0', '00', '-1', '-0', '2.5', '2,5', '1e2', '+3', 'abc', '3 dogs', '1 2', '٣', '２', '2147483648', '99999999999999999999']) {
      expect(parsePlannedDogs(t), JSON.stringify(t)).toBeNull();
    }
  });
});
