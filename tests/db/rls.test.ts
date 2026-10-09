import { describe, expect, it } from 'vitest';
import { as, freshDb } from './harness';

describe('PGlite RLS spike', () => {
  it('hides rows from authenticated when no policy allows them', async () => {
    const db = await freshDb(false);
    await db.exec(`
      create table t (id int); insert into t values (1);
      alter table t enable row level security;
      grant select on t to authenticated;
    `);
    const rows = await as(db, '00000000-0000-0000-0000-000000000001', () => db.query('select * from t'));
    expect(rows.rows).toHaveLength(0);
  });
});
