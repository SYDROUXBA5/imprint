import { describe, expect, it } from 'vitest';
import { BREEDS, PURPOSES, breedLabel, isBreedId, purposeLabel } from '../../src/domain/breeds';

describe('breeds (spec §13.3)', () => {
  it('lists the nine ids, in order, with "other" last', () => {
    expect(BREEDS.map((b) => b.id)).toEqual([
      'malinois', 'german-shepherd', 'dutch-shepherd', 'labrador', 'golden-retriever',
      'bloodhound', 'hound', 'springer-spaniel', 'other',
    ]);
  });

  it('labels each breed for the card, e.g. "Malinois"', () => {
    expect(breedLabel('malinois')).toBe('Malinois');
    expect(breedLabel('golden-retriever')).toBe('Golden Retriever');
    expect(breedLabel('other')).toBe('Other');
    expect(new Set(BREEDS.map((b) => b.label)).size).toBe(9);
  });

  it('recognises only the nine ids', () => {
    expect(isBreedId('hound')).toBe(true);
    expect(isBreedId('poodle')).toBe(false);
    expect(isBreedId(undefined)).toBe(false);
  });
});

describe('purposes', () => {
  it('are single or dual, labelled for the card', () => {
    expect(PURPOSES.map((p) => p.id)).toEqual(['single', 'dual']);
    expect(purposeLabel('single')).toBe('Single purpose');
    expect(purposeLabel('dual')).toBe('Dual purpose');
  });
});
