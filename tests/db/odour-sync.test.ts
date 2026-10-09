import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ODOURS } from '../../src/domain/odours';

it('SQL odour check constraint lists exactly the app odour ids', () => {
  const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8');
  const match = sql.match(/odour_id text not null check \(odour_id in \(([^)]*)\)\)/);
  expect(match).not.toBeNull();
  const ids = match![1].split(',').map((s) => s.trim().replace(/'/g, ''));
  expect(ids.sort()).toEqual(ODOURS.map((o) => o.id).sort());
});
