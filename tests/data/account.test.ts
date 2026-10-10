import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../../src/domain/types';

const member: Member = {
  id: 'm1', unit_id: 'u1', user_id: 'auth-1', name: 'Tess', role: 'trainer', joined_at: '2026-10-03T09:00:00Z', removed_at: null,
};

// Fake of the bits of the Supabase client that account.ts uses.
const eq = vi.fn();
const maybeSingle = vi.fn();
const fake = {
  auth: { signUp: vi.fn(), signInWithPassword: vi.fn(), getUser: vi.fn(), getSession: vi.fn() },
  rpc: vi.fn(),
  from: vi.fn(),
};
vi.mock('../../src/data/supabase', () => ({ supabase: fake }));

const account = await import('../../src/data/account');
const { db, ME_KEY } = await import('../../src/data/db');

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([db.members.clear(), db.meta.clear()]);
  fake.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-1' } } });
  maybeSingle.mockResolvedValue({ data: member, error: null });
  eq.mockReturnValue({ maybeSingle });
  fake.from.mockReturnValue({
    select: () => ({ eq }),
    update: (patch: unknown) => ({ eq: async (col: string, val: string) => ({ error: null, patch, col, val }) }),
  });
});

describe('sign up / sign in', () => {
  it('passes credentials through', async () => {
    fake.auth.signUp.mockResolvedValue({ error: null });
    fake.auth.signInWithPassword.mockResolvedValue({ error: null });
    await account.signUp('a@b.test', 'pw-1');
    await account.signIn('a@b.test', 'pw-1');
    expect(fake.auth.signUp).toHaveBeenCalledWith({ email: 'a@b.test', password: 'pw-1' });
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.test', password: 'pw-1' });
  });

  it('turns an auth error into a thrown Error with the message', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await expect(account.signIn('a@b.test', 'nope')).rejects.toThrow('Invalid login credentials');
  });
});

describe('units', () => {
  it('createUnit trims names, then caches the member for offline use', async () => {
    fake.rpc.mockResolvedValue({ error: null });
    const me = await account.createUnit('  Wells K9 ', ' Tess ');
    expect(fake.rpc).toHaveBeenCalledWith('create_unit', { unit_name: 'Wells K9', member_name: 'Tess' });
    expect(me).toEqual(member);
    expect(await db.members.get('m1')).toEqual(member);
    expect((await db.meta.get(ME_KEY))?.value).toEqual(member);
  });

  it('joinUnit normalises the invite code', async () => {
    fake.rpc.mockResolvedValue({ error: null });
    await account.joinUnit(' abc-234 ', ' Paul ');
    expect(fake.rpc).toHaveBeenCalledWith('join_unit', { code: 'ABC234', member_name: 'Paul' });
  });

  it('joinUnit surfaces the server message for a bad code and caches nothing', async () => {
    fake.rpc.mockResolvedValue({ error: { message: 'invalid invite code' } });
    await expect(account.joinUnit('ZZZZZZ', 'Paul')).rejects.toThrow('invalid invite code');
    expect(await db.meta.get(ME_KEY)).toBeUndefined();
  });
});

describe('loadMe', () => {
  it('returns null when signed out', async () => {
    fake.auth.getUser.mockResolvedValue({ data: { user: null } });
    expect(await account.loadMe()).toBeNull();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('returns null, and caches nothing, when the user has no member row yet', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await account.loadMe()).toBeNull();
    expect(await db.meta.get(ME_KEY)).toBeUndefined();
  });

  it('looks the member up by the signed-in user id', async () => {
    await account.loadMe();
    expect(fake.from).toHaveBeenCalledWith('members');
    expect(eq).toHaveBeenCalledWith('user_id', 'auth-1');
  });

  it('throws a database error rather than pretending nobody is signed in', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'JWT expired' } });
    await expect(account.loadMe()).rejects.toThrow('JWT expired');
  });
});

describe('team actions', () => {
  it('regenerateInviteCode returns the new code', async () => {
    fake.rpc.mockResolvedValue({ data: 'NEW234', error: null });
    expect(await account.regenerateInviteCode()).toBe('NEW234');
    expect(fake.rpc).toHaveBeenCalledWith('regenerate_invite_code');
  });

  it('removeMember stamps removed_at on that member', async () => {
    const update = vi.fn().mockReturnValue({ eq: async () => ({ error: null }) });
    fake.from.mockReturnValue({ update });
    await account.removeMember('m9');
    expect(fake.from).toHaveBeenCalledWith('members');
    expect(update.mock.calls[0][0].removed_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('setRole updates the role, and a server refusal throws', async () => {
    const eqUpdate = vi.fn().mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });
    fake.from.mockReturnValue({ update });
    await expect(account.setRole('m9', 'trainer')).rejects.toThrow(/row-level security/);
    expect(update).toHaveBeenCalledWith({ role: 'trainer' });
    expect(eqUpdate).toHaveBeenCalledWith('id', 'm9');
  });
});

describe('hasSession', () => {
  it('is true only when Supabase holds a session', async () => {
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } }, error: null });
    expect(await account.hasSession()).toBe(true);
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await account.hasSession()).toBe(false);
  });
});
