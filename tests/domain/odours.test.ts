import { describe, expect, it } from 'vitest';
import { ODOURS, odourById, odoursIn } from '../../src/domain/odours';

describe('odours', () => {
  it('has 6 narcotics and 11 explosives', () => {
    expect(odoursIn('narcotics')).toHaveLength(6);
    expect(odoursIn('explosives')).toHaveLength(11);
  });

  it('has unique ids', () => {
    const ids = ODOURS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks odours up by id', () => {
    expect(odourById('mdma')).toEqual({ id: 'mdma', name: 'MDMA', group: 'narcotics' });
    expect(odourById('nope')).toBeUndefined();
  });

  it('keeps the spec order', () => {
    expect(odoursIn('narcotics').map((o) => o.name)).toEqual([
      'Cocaine', 'Heroin', 'Methamphetamine', 'MDMA', 'Cannabis', 'Fentanyl',
    ]);
  });
});
