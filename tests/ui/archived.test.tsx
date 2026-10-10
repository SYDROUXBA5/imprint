import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dogRow, seedCatalogue, team } from '../fixtures';
import type { Dog, Member, Session } from '../../src/domain/types';

const fake = { rpc: vi.fn() };
vi.mock('../../src/data/supabase', () => ({ supabase: fake }));

const { db, ME_KEY } = await import('../../src/data/db');
const { AppRoutes } = await import('../../src/App');

const tess: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const paul: Member = { ...tess, id: 'mP', user_id: 'uP', name: 'Paul', role: 'handler' };
const dog = (id: string, name: string, archived: string | null = null): Dog => dogRow(id, name, { archived_at: archived });
const session = (id: string, dogId: string): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: 'mdma', handler_id: 'mP', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: 600, client_clock_offset_s: null, server_received_at: null,
});

let online = true;
async function seed(me: Member, extra: Dog[] = []) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.bulkPut([tess, paul]);
  await seedCatalogue(db);
  await db.dogs.bulkPut([dog('d1', 'Bella', '2026-10-05T10:00:00Z'), dog('d2', 'Rex', null), ...extra]);
  await db.sessions.bulkPut([session('s1', 'd1'), session('s2', 'd1'), session('s3', 'd2')]);
  // An archived team with one dog (and that dog's two sessions); another team keeps working.
  await db.teams.put(team('t9', 'Retired', '2026-10-06T10:00:00Z'));
  await db.dogs.bulkPut([dogRow('d9', 'Scout', { team_id: 't9' })]);
  await db.sessions.bulkPut([session('s8', 'd9'), session('s9', 'd9')]);
}
const renderApp = (me: Member, at = '/archived') =>
  render(<MemoryRouter initialEntries={[at]}><AppRoutes me={me} /></MemoryRouter>);
const card = async (name: string) => {
  const heading = await screen.findByRole('heading', { name });
  return within(heading.closest('li')!);
};

beforeEach(async () => {
  vi.clearAllMocks();
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  fake.rpc.mockResolvedValue({ data: null, error: null });
  await db.delete();
  await db.open();
});

describe('Archived link on the teams screen', () => {
  it('shows "Archived (2)" to a trainer (the archived team and the archived dog), and it opens the list', async () => {
    await seed(tess);
    renderApp(tess, '/');
    await userEvent.click(await screen.findByRole('link', { name: 'Archived (2)' }));
    expect(await screen.findByRole('heading', { name: 'Bella' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Retired' })).toBeInTheDocument();
  });

  it('is hidden from a handler', async () => {
    await seed(paul);
    renderApp(paul, '/');
    await screen.findByText('Alpha');
    expect(screen.queryByRole('link', { name: /Archived/ })).toBeNull();
  });

  it('is hidden while nothing is archived', async () => {
    await seed(tess);
    await db.dogs.update('d1', { archived_at: null });
    await db.teams.update('t9', { archived_at: null });
    renderApp(tess, '/');
    await screen.findByText('Alpha');
    expect(screen.queryByRole('link', { name: /Archived/ })).toBeNull();
  });
});

describe('/archived route', () => {
  it('sends a handler back to the teams and shows no restore or delete controls', async () => {
    await seed(paul);
    renderApp(paul);
    expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Archived' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete forever/ })).toBeNull();
  });
});

describe('ArchivedScreen: dogs', () => {
  it('lists archived dogs only, with the archive date, Restore and Delete forever', async () => {
    await seed(tess);
    renderApp(tess);
    const bella = await card('Bella');
    expect(bella.getByText('Archived 5 Oct 2026')).toBeInTheDocument();
    expect(bella.getByText('Alpha')).toBeInTheDocument(); // the team it belongs to
    expect(bella.getByRole('button', { name: 'Restore Bella' })).toBeEnabled();
    expect(bella.getByRole('button', { name: 'Delete Bella forever' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Rex' })).toBeNull(); // active dogs are not here
  });

  it('says so when nothing is archived', async () => {
    await seed(tess);
    await db.dogs.update('d1', { archived_at: null });
    renderApp(tess);
    expect(await screen.findByText('No archived dogs')).toBeInTheDocument();
  });

  it('Restore brings the dog back, queues the change and removes it from the list', async () => {
    await seed(tess);
    renderApp(tess);
    await userEvent.click((await card('Bella')).getByRole('button', { name: 'Restore Bella' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Bella' })).toBeNull());
    expect((await db.dogs.get('d1'))!.archived_at).toBeNull();
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ table: 'dogs', op: 'update', row: { id: 'd1', archived_at: null } }),
    ]);
  });

  describe('Delete forever', () => {
    const open = async () => {
      renderApp(tess);
      await userEvent.click((await card('Bella')).getByRole('button', { name: 'Delete Bella forever' }));
      return within(await screen.findByRole('dialog'));
    };

    it('warns with the dog name and the session count', async () => {
      await seed(tess);
      const dialog = await open();
      expect(dialog.getByText('This erases Bella and all 2 sessions. It cannot be undone. Type Bella to confirm.'))
        .toBeInTheDocument();
    });

    it('says "1 session" for a single session', async () => {
      await seed(tess);
      await db.sessions.delete('s2');
      const dialog = await open();
      expect(dialog.getByText(/all 1 session\. It cannot be undone/)).toBeInTheDocument();
    });

    it('keeps the button disabled until the exact name is typed (trimmed, case-sensitive)', async () => {
      await seed(tess);
      const dialog = await open();
      const confirm = dialog.getByRole('button', { name: 'Delete forever' });
      const input = dialog.getByLabelText('Dog name');
      expect(confirm).toBeDisabled();
      await userEvent.type(input, 'bella');
      expect(confirm).toBeDisabled();
      await userEvent.clear(input);
      await userEvent.type(input, 'Bell');
      expect(confirm).toBeDisabled();
      await userEvent.type(input, 'a!');
      expect(confirm).toBeDisabled();
      await userEvent.clear(input);
      await userEvent.type(input, '  Bella ');
      expect(confirm).toBeEnabled();
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it('does nothing when it is not confirmed', async () => {
      await seed(tess);
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Dog name'), 'Bell');
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(fake.rpc).not.toHaveBeenCalled();
      expect(await db.dogs.get('d1')).toBeDefined();
    });

    it('erases the dog on the server and on this phone once the name is typed', async () => {
      await seed(tess);
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Dog name'), 'Bella');
      await userEvent.click(dialog.getByRole('button', { name: 'Delete forever' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.rpc).toHaveBeenCalledWith('delete_dog_forever', { dog: 'd1' });
      expect(await db.dogs.get('d1')).toBeUndefined();
      expect(await db.sessions.where('dog_id').equals('d1').count()).toBe(0);
      expect(await screen.findByText('No archived dogs')).toBeInTheDocument();
      expect(await db.dogs.get('d2')).toBeDefined(); // other dogs stay
    });

    it('shows the server reason and keeps the dog when the server refuses', async () => {
      await seed(tess);
      fake.rpc.mockResolvedValue({ data: null, error: { message: 'stop the running timer before deleting' } });
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Dog name'), 'Bella');
      await userEvent.click(dialog.getByRole('button', { name: 'Delete forever' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('Stop the running timer before deleting');
      expect(await db.dogs.get('d1')).toBeDefined();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('with no signal', () => {
    it('disables Delete forever with "Needs signal." but Restore still works', async () => {
      await seed(tess);
      online = false;
      renderApp(tess);
      const bella = await card('Bella');
      expect(bella.getByRole('button', { name: 'Delete Bella forever' })).toBeDisabled();
      expect(bella.getByText('Needs signal.')).toBeInTheDocument();
      expect(bella.getByRole('button', { name: 'Restore Bella' })).toBeEnabled();
      await userEvent.click(bella.getByRole('button', { name: 'Restore Bella' }));
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Bella' })).toBeNull());
      expect((await db.dogs.get('d1'))!.archived_at).toBeNull();
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it('also blocks the confirm button if the signal drops while the dialog is open', async () => {
      await seed(tess);
      renderApp(tess);
      await userEvent.click((await card('Bella')).getByRole('button', { name: 'Delete Bella forever' }));
      const dialog = within(await screen.findByRole('dialog'));
      await userEvent.type(dialog.getByLabelText('Dog name'), 'Bella');
      expect(dialog.getByRole('button', { name: 'Delete forever' })).toBeEnabled();
      online = false;
      act(() => { window.dispatchEvent(new Event('offline')); });
      await waitFor(() => expect(dialog.getByRole('button', { name: 'Delete forever' })).toBeDisabled());
      expect(dialog.getByText('Needs signal.')).toBeInTheDocument();
    });
  });
});

describe('ArchivedScreen: teams', () => {
  const teamCard = async (name: string) => card(name);
  const open = async () => {
    renderApp(tess);
    await userEvent.click((await teamCard('Retired')).getByRole('button', { name: 'Delete Retired forever' }));
    return within(await screen.findByRole('dialog'));
  };

  it('lists archived teams with the archive date, their dogs, Restore and Delete forever', async () => {
    await seed(tess);
    renderApp(tess);
    const retired = await teamCard('Retired');
    expect(retired.getByText('Archived 6 Oct 2026')).toBeInTheDocument();
    expect(retired.getByText('1 dog')).toBeInTheDocument();
    expect(retired.getByRole('button', { name: 'Restore Retired' })).toBeEnabled();
    expect(retired.getByRole('button', { name: 'Delete Retired forever' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Alpha' })).toBeNull(); // active teams are not here
    expect(screen.queryByRole('heading', { name: 'Scout' })).toBeNull(); // a dog of an archived team goes with its team
  });

  it('says so when no team is archived', async () => {
    await seed(tess);
    await db.teams.update('t9', { archived_at: null });
    renderApp(tess);
    expect(await screen.findByText('No archived teams')).toBeInTheDocument();
  });

  it('Restore brings the team and its dogs back, queues the change and removes it from the list', async () => {
    await seed(tess);
    renderApp(tess);
    await userEvent.click((await teamCard('Retired')).getByRole('button', { name: 'Restore Retired' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Retired' })).toBeNull());
    expect((await db.teams.get('t9'))!.archived_at).toBeNull();
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ table: 'teams', op: 'update', row: { id: 't9', archived_at: null } }),
    ]);
    expect((await db.dogs.get('d9'))!.archived_at).toBeNull(); // the dog was never archived on its own
  });

  describe('Delete forever', () => {
    it('warns with the team name, its dog count and the session count', async () => {
      await seed(tess);
      const dialog = await open();
      expect(dialog.getByText('This erases team Retired, its 1 dog and all 2 sessions. It cannot be undone. Type Retired to confirm.'))
        .toBeInTheDocument();
      expect(dialog.getByLabelText('Team name')).toBeInTheDocument();
    });

    it('counts every dog of the team, archived ones too', async () => {
      await seed(tess);
      await db.dogs.put(dogRow('d10', 'Gone', { team_id: 't9', archived_at: '2026-10-01T00:00:00Z' }));
      const dialog = await open();
      expect(dialog.getByText(/its 2 dogs and all 2 sessions/)).toBeInTheDocument();
    });

    it('keeps the button disabled until the exact name is typed (trimmed, case-sensitive)', async () => {
      await seed(tess);
      const dialog = await open();
      const confirm = dialog.getByRole('button', { name: 'Delete forever' });
      const input = dialog.getByLabelText('Team name');
      expect(confirm).toBeDisabled();
      await userEvent.type(input, 'retired');
      expect(confirm).toBeDisabled();
      await userEvent.clear(input);
      await userEvent.type(input, 'Retire');
      expect(confirm).toBeDisabled();
      await userEvent.type(input, 'd!');
      expect(confirm).toBeDisabled();
      await userEvent.clear(input);
      await userEvent.type(input, ' Retired ');
      expect(confirm).toBeEnabled();
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it('does nothing when it is not confirmed', async () => {
      await seed(tess);
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Team name'), 'Retire');
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(fake.rpc).not.toHaveBeenCalled();
      expect(await db.teams.get('t9')).toBeDefined();
    });

    it('erases the team, its dogs and their sessions on the server and on this phone once the name is typed', async () => {
      await seed(tess);
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Team name'), 'Retired');
      await userEvent.click(dialog.getByRole('button', { name: 'Delete forever' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.rpc).toHaveBeenCalledWith('delete_team_forever', { team: 't9' });
      expect(await db.teams.get('t9')).toBeUndefined();
      expect(await db.dogs.get('d9')).toBeUndefined();
      expect(await db.sessions.where('dog_id').equals('d9').count()).toBe(0);
      expect(await screen.findByText('No archived teams')).toBeInTheDocument();
      expect(await db.teams.get('t1')).toBeDefined(); // other teams and their dogs stay
      expect(await db.dogs.get('d2')).toBeDefined();
    });

    it('shows the server reason and keeps the team when the server refuses', async () => {
      await seed(tess);
      fake.rpc.mockResolvedValue({ data: null, error: { message: 'stop the running timer before deleting' } });
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Team name'), 'Retired');
      await userEvent.click(dialog.getByRole('button', { name: 'Delete forever' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('Stop the running timer before deleting');
      expect(await db.teams.get('t9')).toBeDefined();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('with no signal', () => {
    it('disables Delete forever with "Needs signal." but Restore still works', async () => {
      await seed(tess);
      online = false;
      renderApp(tess);
      const retired = await teamCard('Retired');
      expect(retired.getByRole('button', { name: 'Delete Retired forever' })).toBeDisabled();
      expect(retired.getByText('Needs signal.')).toBeInTheDocument();
      await userEvent.click(retired.getByRole('button', { name: 'Restore Retired' }));
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Retired' })).toBeNull());
      expect((await db.teams.get('t9'))!.archived_at).toBeNull();
      expect(fake.rpc).not.toHaveBeenCalled();
    });
  });
});
