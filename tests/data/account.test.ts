import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = '0123456789abcdef0123456789abcdef';
const entered = {
  unit_id: 'u1', unit_name: 'Wells K9', scope: 'handler',
  names: [{ id: 'm2', name: 'Hana' }, { id: 'm1', name: 'Paul' }],
};

// Fake of the bits of the Supabase client that account.ts uses.
const fake = {
  auth: { getSession: vi.fn(), signInAnonymously: vi.fn() },
  rpc: vi.fn(),
};
vi.mock('../../src/data/supabase', () => ({ supabase: fake }));

const account = await import('../../src/data/account');
const { db, ME_KEY, ACCESS_KEY } = await import('../../src/data/db');

/** Everything the local database holds, as one string: for "the token is nowhere in it". */
async function everythingStored(): Promise<string> {
  const all: unknown[] = [];
  for (const table of db.tables) all.push(await table.toArray());
  return JSON.stringify(all);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await Promise.all(db.tables.map((t) => t.clear()));
  fake.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
  fake.auth.signInAnonymously.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
  fake.rpc.mockResolvedValue({ data: entered, error: null });
});

describe('enterWithLink', () => {
  it('clears data left on the phone by another unit, and its sync cursors', async () => {
    await db.meta.put({ key: ME_KEY, value: { unit_id: 'other-unit', scope: 'trainer', member_id: 'mX' } });
    await db.meta.put({ key: 'cursor:dogs', value: '2026-01-01T00:00:00Z' });
    await db.teams.put({ id: 't9', unit_id: 'other-unit', name: 'Old team' } as never);
    await db.dogs.put({ id: 'd9', unit_id: 'other-unit', team_id: 't9', name: 'Old dog' } as never);
    await db.outbox.add({ table: 'dogs', op: 'insert', row: { id: 'd9' }, created_at: '', status: 'pending' });
    await account.enterWithLink(TOKEN);
    expect(await db.teams.count()).toBe(0);
    expect(await db.dogs.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.get('cursor:dogs')).toBeUndefined();
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'handler', member_id: null });
  });

  it('keeps local data and unsynced work when the phone re-enters the same unit', async () => {
    await db.meta.put({ key: ME_KEY, value: { unit_id: 'u1', scope: 'handler', member_id: 'm1' } });
    await db.meta.put({ key: 'cursor:dogs', value: '2026-01-01T00:00:00Z' });
    await db.dogs.put({ id: 'd1', unit_id: 'u1', team_id: 't1', name: 'Juno' } as never);
    await db.outbox.add({ table: 'sessions', op: 'insert', row: { id: 's1' }, created_at: '', status: 'pending' });
    await account.enterWithLink(TOKEN);
    expect(await db.dogs.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.meta.get('cursor:dogs'))?.value).toBe('2026-01-01T00:00:00Z');
  });

  it('signs in anonymously when the phone has no session, then opens the link', async () => {
    fake.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await account.enterWithLink(TOKEN);
    expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith('enter_with_link', { link_token: TOKEN });
    expect(fake.auth.signInAnonymously.mock.invocationCallOrder[0]).toBeLessThan(fake.rpc.mock.invocationCallOrder[0]);
  });

  it('does not sign in again when the phone already has a session', async () => {
    await account.enterWithLink(TOKEN);
    expect(fake.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('two openings at once share one anonymous sign-in', async () => {
    fake.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await Promise.all([account.enterWithLink(TOKEN), account.enterWithLink(TOKEN)]);
    expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('returns the unit, the scope and the names to pick from', async () => {
    expect(await account.enterWithLink(TOKEN)).toEqual(entered);
  });

  it('remembers unit and scope, with no name yet, and keeps the token out of the local database', async () => {
    await account.enterWithLink(` ${TOKEN.toUpperCase()} `);
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'handler', member_id: null });
    expect(await everythingStored()).not.toContain(TOKEN);
    expect(fake.rpc).toHaveBeenCalledWith('enter_with_link', { link_token: TOKEN }); // trimmed and lower-cased
  });

  it('a link that opens clears an earlier "your link has changed"', async () => {
    await db.meta.put({ key: ACCESS_KEY, value: 'lost' });
    await account.enterWithLink(TOKEN);
    expect(await db.meta.get(ACCESS_KEY)).toBeUndefined();
  });

  it('a link that does not open changes nothing here', async () => {
    await db.meta.put({ key: ME_KEY, value: { unit_id: 'u1', scope: 'trainer', member_id: 'm9' } });
    fake.rpc.mockResolvedValue({ data: null, error: { message: 'invalid link', code: '28000' } });
    await expect(account.enterWithLink(TOKEN)).rejects.toThrow('invalid link');
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'trainer', member_id: 'm9' });
  });

  it('a failed anonymous sign-in is reported and no rpc is made', async () => {
    fake.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    fake.auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: 'Anonymous sign-ins are disabled' } });
    await expect(account.enterWithLink(TOKEN)).rejects.toThrow('Anonymous sign-ins are disabled');
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('never logs the token, whether the link opens or not', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await account.enterWithLink(TOKEN);
    fake.rpc.mockResolvedValue({ data: null, error: { message: 'invalid link' } });
    await account.enterWithLink(TOKEN).catch(() => {});
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
  });
});

describe('choosing a name', () => {
  const chosen = { unit_id: 'u1', scope: 'handler', member_id: 'm1', name: 'Paul' };

  it('chooseName tells the server which name, then remembers unit, scope and name', async () => {
    fake.rpc.mockResolvedValue({ data: chosen, error: null });
    await account.chooseName('m1');
    expect(fake.rpc).toHaveBeenCalledWith('choose_name', { member: 'm1' });
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'handler', member_id: 'm1' });
    expect(await db.members.get('m1')).toMatchObject({ id: 'm1', unit_id: 'u1', name: 'Paul', role: 'handler', removed_at: null });
  });

  it('addName trims, sends the name, and signs the phone in under it', async () => {
    fake.rpc.mockResolvedValue({ data: { ...chosen, member_id: 'm7', name: 'Sam' }, error: null });
    await account.addName('  Sam ');
    expect(fake.rpc).toHaveBeenCalledWith('add_name', { person_name: 'Sam' });
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'handler', member_id: 'm7' });
    expect((await db.members.get('m7'))?.name).toBe('Sam');
  });

  it('a refused name changes nothing and shows the server’s reason', async () => {
    await db.meta.put({ key: ME_KEY, value: { unit_id: 'u1', scope: 'handler', member_id: null } });
    fake.rpc.mockResolvedValue({ data: null, error: { message: 'name taken', code: '23505' } });
    await expect(account.addName('Paul')).rejects.toThrow('name taken');
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'handler', member_id: null });
  });

  it('a name chosen after the link changed clears "your link has changed"', async () => {
    await db.meta.put({ key: ACCESS_KEY, value: 'lost' });
    fake.rpc.mockResolvedValue({ data: chosen, error: null });
    await account.chooseName('m1');
    expect(await db.meta.get(ACCESS_KEY)).toBeUndefined();
  });

  it('an empty name is not sent', async () => {
    await expect(account.addName('   ')).rejects.toThrow(/name/i);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

describe('switching names', () => {
  it('switchName forgets the name here at once, with no signal needed, and keeps unit and scope', async () => {
    await db.meta.put({ key: ME_KEY, value: { unit_id: 'u1', scope: 'trainer', member_id: 'm1' } });
    await account.switchName();
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'trainer', member_id: null });
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.auth.getSession).not.toHaveBeenCalled();
  });

  it('switchName with nobody in does nothing', async () => {
    await account.switchName();
    expect(await db.meta.get(ME_KEY)).toBeUndefined();
  });

  it('loadNames asks the server for the names of the list this phone entered by', async () => {
    expect(await account.loadNames()).toEqual(entered);
    expect(fake.rpc).toHaveBeenCalledWith('switch_name');
  });

  it('loadNames reports a link that no longer works', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { message: 'invalid link' } });
    await expect(account.loadNames()).rejects.toThrow('invalid link');
  });
});

describe('the trainer’s link tools', () => {
  it('getLinks returns both tokens and keeps them out of the local database', async () => {
    fake.rpc.mockResolvedValue({ data: { trainer: TOKEN, handler: 'f'.repeat(32) }, error: null });
    expect(await account.getLinks()).toEqual({ trainer: TOKEN, handler: 'f'.repeat(32) });
    expect(fake.rpc).toHaveBeenCalledWith('get_links');
    const stored = await everythingStored();
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain('f'.repeat(32));
  });

  it('regenerateLink returns the new token for the role', async () => {
    fake.rpc.mockResolvedValue({ data: 'a'.repeat(32), error: null });
    expect(await account.regenerateLink('handler')).toBe('a'.repeat(32));
    expect(fake.rpc).toHaveBeenCalledWith('regenerate_link', { link_role: 'handler' });
    expect(await everythingStored()).not.toContain('a'.repeat(32));
  });

  it('removeMember removes on the server, then marks the name removed here', async () => {
    await db.members.put({ id: 'm9', unit_id: 'u1', user_id: null, name: 'Olga', role: 'handler', joined_at: '', removed_at: null });
    fake.rpc.mockResolvedValue({ data: null, error: null });
    await account.removeMember('m9');
    expect(fake.rpc).toHaveBeenCalledWith('remove_member', { member: 'm9' });
    expect((await db.members.get('m9'))?.removed_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('a refusal throws and removes nothing here', async () => {
    await db.members.put({ id: 'm9', unit_id: 'u1', user_id: null, name: 'Olga', role: 'trainer', joined_at: '', removed_at: null });
    fake.rpc.mockResolvedValue({ data: null, error: { message: 'a unit needs at least one trainer' } });
    await expect(account.removeMember('m9')).rejects.toThrow('a unit needs at least one trainer');
    expect((await db.members.get('m9'))?.removed_at).toBeNull();
  });
});

describe('readAccess', () => {
  const rec = (member_id: string | null) => ({ unit_id: 'u1', scope: 'handler' as const, member_id });

  it('nobody has entered: none', async () => {
    expect(await account.readAccess(db)).toEqual({ kind: 'none' });
  });

  it('a record left by the old sign-in app is not an entry: none', async () => {
    await db.meta.put({ key: ME_KEY, value: { id: 'm1', unit_id: 'u1', user_id: 'a1', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null } });
    expect(await account.readAccess(db)).toEqual({ kind: 'none' });
  });

  it('entered with no name yet: pick', async () => {
    await db.meta.put({ key: ME_KEY, value: rec(null) });
    expect(await account.readAccess(db)).toEqual({ kind: 'pick', unit_id: 'u1', scope: 'handler' });
  });

  it('entered with a name: in, with the power of the link and the name from the local list', async () => {
    await db.meta.put({ key: ME_KEY, value: rec('m1') });
    await db.members.put({ id: 'm1', unit_id: 'u1', user_id: null, name: 'Paul', role: 'handler', joined_at: '', removed_at: null });
    expect(await account.readAccess(db)).toEqual({ kind: 'in', me: { id: 'm1', unit_id: 'u1', role: 'handler', name: 'Paul' } });
  });

  it('the power is the scope of the link, never the role of the name the list happens to hold', async () => {
    await db.meta.put({ key: ME_KEY, value: rec('m1') });
    await db.members.put({ id: 'm1', unit_id: 'u1', user_id: null, name: 'Tess', role: 'trainer', joined_at: '', removed_at: null });
    const a = await account.readAccess(db);
    expect(a).toMatchObject({ kind: 'in', me: { role: 'handler' } });
  });

  it('access lost: lost, whatever else is stored', async () => {
    await db.meta.put({ key: ME_KEY, value: rec('m1') });
    await account.markLost(db);
    expect(await account.readAccess(db)).toEqual({ kind: 'lost' });
  });

  it('lost, but nothing was ever entered: none', async () => {
    await account.markLost(db);
    expect(await account.readAccess(db)).toEqual({ kind: 'none' });
  });
});
