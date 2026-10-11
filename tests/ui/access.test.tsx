import { act, configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeRecord } from '../../src/data/db';
import { seedCatalogue } from '../fixtures';

// Several awaits deep (router, local database, server fake): give a loaded machine more than the default second.
configure({ asyncUtilTimeout: 5000 });

// The whole way in, through the real App, router, account module and local database; only the server is faked.

const TOKEN = '0123456789abcdef0123456789abcdef';
const NEW_TOKEN = 'fedcba9876543210fedcba9876543210';
const names = [{ id: 'mH2', name: 'Hana' }, { id: 'mP', name: 'Paul' }];

const fake = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), signInAnonymously: vi.fn() },
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../../src/data/supabase', () => ({ supabase: fake }));
const sync = vi.hoisted(() => ({ startSyncLoop: vi.fn() }));
vi.mock('../../src/data/sync', async (original) => ({ ...(await original<typeof import('../../src/data/sync')>()), startSyncLoop: sync.startSyncLoop }));

const { default: App } = await import('../../src/App');
const { db, ME_KEY, ACCESS_KEY } = await import('../../src/data/db');

let online = true;
const stopSync = vi.fn();

function answer(valid: string[] = [TOKEN]) {
  fake.rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
    if (name === 'enter_with_link') {
      return valid.includes(args.link_token)
        ? { data: { unit_id: 'u1', unit_name: 'Wells K9', scope: 'handler', names }, error: null }
        : { data: null, error: { message: 'invalid link', code: '28000' } };
    }
    if (name === 'switch_name') return { data: { unit_id: 'u1', unit_name: 'Wells K9', scope: 'handler', names }, error: null };
    if (name === 'choose_name') {
      return { data: { unit_id: 'u1', scope: 'handler', member_id: args.member, name: names.find((n) => n.id === args.member)!.name }, error: null };
    }
    if (name === 'add_name') return { data: { unit_id: 'u1', scope: 'handler', member_id: 'mNew', name: args.person_name }, error: null };
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  });
}

async function everythingStored(): Promise<string> {
  const all: unknown[] = [];
  for (const table of db.tables) all.push(await table.toArray());
  return JSON.stringify(all);
}

const goTo = (hash: string) => window.history.replaceState(null, '', `/${hash}`);

beforeEach(async () => {
  vi.clearAllMocks();
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  sync.startSyncLoop.mockReturnValue(stopSync);
  fake.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
  fake.auth.signInAnonymously.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
  answer();
  await db.delete();
  await db.open();
  goTo('');
});
afterEach(() => {
  vi.restoreAllMocks();
  goTo('');
});

async function seedIn(scope: MeRecord['scope'] = 'handler', memberId = 'mP') {
  await db.meta.put({ key: ME_KEY, value: { unit_id: 'u1', scope, member_id: memberId } satisfies MeRecord });
  await db.units.put({ id: 'u1', name: 'Wells K9', created_at: '2026-10-01T00:00:00Z' });
  await db.members.bulkPut(names.map((n) => ({
    id: n.id, unit_id: 'u1', user_id: null, name: n.name, role: 'handler' as const, joined_at: '', removed_at: null,
  })));
  await seedCatalogue(db, ['t1']);
}

describe('opening a link', () => {
  it('shows Who are you? with the names, and takes the token out of the address bar without adding a history entry', async () => {
    goTo(`#/handler/${TOKEN}`);
    const push = vi.spyOn(window.history, 'pushState');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Who are you?' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Paul' })).toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledWith('enter_with_link', { link_token: TOKEN });
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe('#/');
    expect(push).not.toHaveBeenCalled();
  });

  it('works the same on the trainer link', async () => {
    goTo(`#/trainer/${TOKEN}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledWith('enter_with_link', { link_token: TOKEN });
  });

  it('a name tapped is the way in: the Teams screen, and only then does syncing start', async () => {
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Paul' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledWith('choose_name', { member: 'mP' });
    expect(sync.startSyncLoop).toHaveBeenCalledTimes(1);
    expect(sync.startSyncLoop.mock.calls[0][0]).toMatchObject({ unitId: 'u1' });
  });

  it('adding a name is the way in too', async () => {
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add my name' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledWith('add_name', { person_name: 'Sam' });
  });

  it('no sync runs while the phone has not picked a name', async () => {
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    await screen.findByRole('button', { name: 'Paul' });
    expect(sync.startSyncLoop).not.toHaveBeenCalled();
  });

  it('the token is nowhere in the local database, and is never logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Paul' }));
    await screen.findByRole('heading', { name: 'Teams' });
    expect(await everythingStored()).not.toContain(TOKEN);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
  });

  it('the phone’s power is the link it entered by, whichever name it taps', async () => {
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Paul' }));
    await screen.findByRole('heading', { name: 'Teams' });
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'u1', scope: 'handler', member_id: 'mP' });
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ New team' })).toBeNull();
  });

  it('a link that does not work says so, and the token leaves the address bar all the same', async () => {
    goTo(`#/handler/${NEW_TOKEN}`);
    render(<App />);
    expect(await screen.findByText("That link doesn't work any more. Ask your trainer for the new one.")).toBeInTheDocument();
    expect(window.location.href).not.toContain(NEW_TOKEN);
    expect(await everythingStored()).not.toContain(NEW_TOKEN);
  });

  it('something that is not a token is not even sent', async () => {
    goTo('#/handler/not-a-token');
    render(<App />);
    expect(await screen.findByText("That link doesn't work any more. Ask your trainer for the new one.")).toBeInTheDocument();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('with no signal it says so, keeps the link in the address bar, and can try again', async () => {
    fake.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Needs signal to open the link.');
    expect(window.location.hash).toContain(TOKEN);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Paul' })).toBeInTheDocument();
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('opens the very first time with an anonymous sign-in', async () => {
    fake.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    await screen.findByRole('button', { name: 'Paul' });
    expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});

describe('a phone that has already entered', () => {
  it('opens straight on the Teams screen with no call to the server, even with no signal at all', async () => {
    await seedIn();
    online = false;
    fake.auth.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    fake.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeInTheDocument();
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.auth.getSession).not.toHaveBeenCalled();
    expect(fake.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('starts syncing for its unit', async () => {
    await seedIn();
    render(<App />);
    await screen.findByRole('heading', { name: 'Teams' });
    expect(sync.startSyncLoop).toHaveBeenCalledTimes(1);
    expect(sync.startSyncLoop.mock.calls[0][0]).toMatchObject({ unitId: 'u1' });
  });

  it('opening a link again asks who you are again', async () => {
    await seedIn();
    goTo(`#/handler/${TOKEN}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(sync.startSyncLoop).not.toHaveBeenCalled();
  });

  it('a link that no longer works leaves it where it was', async () => {
    await seedIn();
    goTo(`#/handler/${NEW_TOKEN}`);
    render(<App />);
    expect(await screen.findByText("That link doesn't work any more. Ask your trainer for the new one.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeInTheDocument();
  });
});

describe('no way in', () => {
  it('a phone that never entered sees the paste screen, and no sync runs', async () => {
    render(<App />);
    expect(await screen.findByText('Open the link your trainer sent you, or paste it here.')).toBeInTheDocument();
    expect(sync.startSyncLoop).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('what the old sign-in version left behind is not an entry', async () => {
    await db.meta.put({ key: ME_KEY, value: { id: 'm1', unit_id: 'u1', user_id: 'a1', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null } });
    render(<App />);
    expect(await screen.findByText('Open the link your trainer sent you, or paste it here.')).toBeInTheDocument();
  });

  it('a screen that needs a trainer is not reachable from there', async () => {
    goTo('#/members');
    render(<App />);
    expect(await screen.findByText('Open the link your trainer sent you, or paste it here.')).toBeInTheDocument();
  });
});

describe('losing access while the app is open', () => {
  it('stops syncing, keeps the unsent work, and shows "Your link has changed"', async () => {
    await seedIn();
    await db.outbox.add({ table: 'dogs', op: 'insert', row: { id: 'dX' }, created_at: '2026-10-03T10:00:00Z', status: 'pending' });
    render(<App />);
    await screen.findByRole('heading', { name: 'Teams' });
    const deps = sync.startSyncLoop.mock.calls[0][0] as { onLostAccess: () => void };
    await act(async () => { deps.onLostAccess(); });

    expect(await screen.findByText('Your link has changed. Ask your trainer for the new one.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Teams' })).toBeNull();
    expect(stopSync).toHaveBeenCalled();
    expect((await db.meta.get(ACCESS_KEY))?.value).toBe('lost');
    expect(await db.outbox.where('status').equals('pending').count()).toBe(1);
    expect(await db.dogs.count()).toBe(0); // nothing wiped
    expect(await db.sessions.count()).toBe(0);
    expect(await db.teams.count()).toBe(1);
  });

  it('is still shown after the app is closed and opened again', async () => {
    await seedIn();
    await db.meta.put({ key: ACCESS_KEY, value: 'lost' });
    render(<App />);
    expect(await screen.findByText('Your link has changed. Ask your trainer for the new one.')).toBeInTheDocument();
    expect(sync.startSyncLoop).not.toHaveBeenCalled();
  });

  it('the new link brings the phone back in with its unsent work, and syncing starts again', async () => {
    answer([NEW_TOKEN]);
    await seedIn();
    await db.outbox.add({ table: 'dogs', op: 'insert', row: { id: 'dX' }, created_at: '2026-10-03T10:00:00Z', status: 'pending' });
    await db.meta.put({ key: ACCESS_KEY, value: 'lost' });
    render(<App />);
    await userEvent.click(await screen.findByLabelText('Your link'));
    await userEvent.paste(`https://sydrouxba5.github.io/imprint/#/handler/${NEW_TOKEN}`);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Paul' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeInTheDocument();
    expect(await db.meta.get(ACCESS_KEY)).toBeUndefined();
    expect(await db.outbox.where('status').equals('pending').count()).toBe(1);
    await waitFor(() => expect(sync.startSyncLoop).toHaveBeenCalledTimes(1));
    expect(fake.rpc).toHaveBeenCalledWith('enter_with_link', { link_token: NEW_TOKEN });
  });

  it('a removed name or a replaced link met on the Who are you? screen is the same message', async () => {
    await db.meta.put({ key: ME_KEY, value: { unit_id: 'u1', scope: 'handler', member_id: null } satisfies MeRecord });
    fake.rpc.mockResolvedValue({ data: null, error: { message: 'invalid link' } });
    render(<App />);
    expect(await screen.findByText('Your link has changed. Ask your trainer for the new one.')).toBeInTheDocument();
  });
});
