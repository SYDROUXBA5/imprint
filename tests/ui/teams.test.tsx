import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import type { Member, Session } from '../../src/domain/types';
import { dogRow, seedCatalogue, team } from '../fixtures';
import { TeamsScreen } from '../../src/ui/screens/TeamsScreen';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { id: 'mH', unit_id: 'u1', user_id: 'uH', name: 'Paul', role: 'handler', joined_at: '', removed_at: null };
const running = (id: string, dogId: string, odour: string): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mH', kind: 'timed', session_date: '2026-10-05',
  started_at: new Date(Date.now() - 724_000).toISOString(), ended_at: null, duration_s: null,
  client_clock_offset_s: null, server_received_at: null,
});

/** Alpha: Rex, Bella (and an archived Old Max). Bravo: Fly. Retired (archived team): Hidden. */
async function seed(me: Member) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.bulkPut([trainer, handler]);
  await seedCatalogue(db, ['t1', 't2']);
  await db.teams.update('t2', { name: 'Bravo' });
  await db.teams.put(team('t3', 'Retired', '2026-10-05T00:00:00Z'));
  await db.dogs.bulkPut([
    dogRow('d1', 'Rex'), dogRow('d2', 'Bella'), dogRow('d3', 'Old Max', { archived_at: '2026-10-02T00:00:00Z' }),
    dogRow('d4', 'Fly', { team_id: 't2' }), dogRow('d5', 'Hidden', { team_id: 't3' }),
  ]);
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}
const renderHome = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<TeamsScreen />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('TeamsScreen (home)', () => {
  it('is called Teams and lists the active teams by name, with their dog counts', async () => {
    await seed(trainer);
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeInTheDocument();
    const alpha = await screen.findByRole('button', { name: /Alpha/ });
    expect(within(alpha).getByText('Alpha')).toBeInTheDocument();
    expect(within(alpha).getByText('2 dogs')).toBeInTheDocument(); // the archived Old Max is not counted
    const bravo = screen.getByRole('button', { name: /Bravo/ });
    expect(within(bravo).getByText('1 dog')).toBeInTheDocument();
    const names = screen.getAllByRole('listitem').map((li) => within(li).getByRole('button').textContent);
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/Alpha/);
    expect(names[1]).toMatch(/Bravo/);
  });

  it('leaves an archived team out, and says "0 dogs" for an empty one', async () => {
    await seed(trainer);
    await db.teams.put(team('t9', 'Empty'));
    renderHome();
    await screen.findByRole('button', { name: /Alpha/ });
    expect(screen.queryByText('Retired')).toBeNull();
    expect(within(screen.getByRole('button', { name: /Empty/ })).getByText('0 dogs')).toBeInTheDocument();
  });

  it('opens a team on tap', async () => {
    await seed(trainer);
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: /Bravo/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/team/t2');
  });

  it('puts a dot on a team with a timer running, and pins the timer at the top', async () => {
    await seed(trainer);
    await db.sessions.put(running('r', 'd4', 'mdma'));
    renderHome();
    expect(await screen.findByText(/^Running · Fly · MDMA · 12:0[4-9] · Paul$/)).toBeInTheDocument();
    const bravo = screen.getByRole('button', { name: /Bravo/ });
    expect(within(bravo).getByRole('img', { name: 'Timer running' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Alpha/ })).queryByRole('img', { name: 'Timer running' })).toBeNull();
  });

  it('counts a running timer only for a team that is shown', async () => {
    await seed(trainer);
    await db.sessions.put(running('r', 'd5', 'mdma')); // a dog of the archived team
    renderHome();
    await screen.findByRole('button', { name: /Alpha/ });
    expect(screen.queryByRole('img', { name: 'Timer running' })).toBeNull();
    expect(screen.queryByText(/^Running/)).toBeNull();
  });

  it('links a trainer to Members, Odours and Archived (teams plus archived dogs of active teams)', async () => {
    await seed(trainer);
    renderHome();
    await screen.findByRole('button', { name: /Alpha/ });
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/members');
    expect(screen.getByRole('link', { name: 'Odours' })).toHaveAttribute('href', '/odours');
    expect(screen.getByRole('link', { name: 'Archived (2)' })).toHaveAttribute('href', '/archived');
  });

  it('hides "Archived" while nothing is archived', async () => {
    await seed(trainer);
    await db.teams.update('t3', { archived_at: null });
    await db.dogs.update('d3', { archived_at: null });
    renderHome();
    await screen.findByRole('button', { name: /Alpha/ });
    expect(screen.queryByRole('link', { name: /Archived/ })).toBeNull();
  });

  it('has the field-guide heading, and an empty state that points a trainer to the first team', async () => {
    await db.meta.put({ key: ME_KEY, value: trainer });
    renderHome();
    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first team')).toBeInTheDocument();
    expect(screen.getByText(/Trainer.s field guide/i)).toBeInTheDocument();
  });

  it('shows a handler the team cards and nothing else', async () => {
    await seed(handler);
    renderHome();
    await screen.findByRole('button', { name: /Alpha/ });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /new team/i })).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Alpha'), expect.stringContaining('Bravo'),
    ]);
  });

  it('has an empty state for a handler too', async () => {
    await db.meta.put({ key: ME_KEY, value: handler });
    renderHome();
    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
    expect(screen.queryByText('Create your first team')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the sync badge with the number of unsynced records', async () => {
    await seed(trainer);
    await db.outbox.add({ table: 'dogs', op: 'insert', row: { id: 'd1' }, created_at: new Date().toISOString(), status: 'pending' });
    renderHome();
    expect(await screen.findByText('1 record not synced yet')).toBeInTheDocument();
  });

  it('shows a one-off sync notice once, and lets it be dismissed', async () => {
    await seed(trainer);
    await db.meta.put({ key: 'notices', value: ['A session for a deleted dog was discarded.'] });
    const { unmount } = renderHome();
    expect(await screen.findByText('A session for a deleted dog was discarded.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('A session for a deleted dog was discarded.')).toBeNull();
    unmount();
    renderHome();
    await screen.findByRole('button', { name: /Alpha/ });
    expect(screen.queryByText('A session for a deleted dog was discarded.')).toBeNull();
  });

  describe('+ New team', () => {
    const sheet = async () => within(await screen.findByRole('dialog'));
    const open = async () => {
      await seed(trainer);
      renderHome();
      await userEvent.click(await screen.findByRole('button', { name: '+ New team' }));
      return sheet();
    };

    it('asks for a name and the odours the team trains, and Create team waits for both', async () => {
      const dialog = await open();
      const create = dialog.getByRole('button', { name: 'Create team' });
      expect(dialog.getByLabelText('Team name')).toHaveValue('');
      expect(dialog.getByRole('group', { name: 'Narcotics' })).toBeInTheDocument();
      expect(dialog.getAllByRole('checkbox').filter((b) => (b as HTMLInputElement).checked)).toHaveLength(0); // nothing is chosen for you
      expect(create).toBeDisabled();
      await userEvent.type(dialog.getByLabelText('Team name'), 'Charlie');
      expect(create).toBeDisabled();
      expect(dialog.getByText('Pick at least one odour')).toBeInTheDocument();
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      expect(create).toBeEnabled();
      expect(dialog.queryByText('Pick at least one odour')).toBeNull();
      await userEvent.clear(dialog.getByLabelText('Team name'));
      expect(create).toBeDisabled();
    });

    it('needs an odour: unticking the last one disables Create team again', async () => {
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Team name'), 'Charlie');
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      expect(dialog.getByRole('button', { name: 'Create team' })).toBeDisabled();
    });

    it('creates the team with exactly the ticked odours, through the outbox, and shows its card', async () => {
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Team name'), '  Charlie ');
      await userEvent.click(dialog.getByRole('button', { name: 'Select all Cadaver' }));
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
      const card = await screen.findByRole('button', { name: /Charlie/ });
      expect(within(card).getByText('0 dogs')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
      const made = (await db.teams.toArray()).find((t) => t.name === 'Charlie')!;
      const picks = await db.team_odours.where('team_id').equals(made.id).toArray();
      expect(picks.filter((p) => p.selected).map((p) => p.odour_id).sort()).toEqual(['cocaine', 'human-remains']);
      expect((await db.outbox.toArray()).map((i) => i.table)).toEqual(['teams', 'team_odours', 'team_odours']);
    });

    it('offers no archived odour or category', async () => {
      await seed(trainer);
      await db.odours.update('cocaine', { archived_at: '2026-10-02T00:00:00Z' });
      await db.odour_categories.update('cadaver', { archived_at: '2026-10-02T00:00:00Z' });
      renderHome();
      await userEvent.click(await screen.findByRole('button', { name: '+ New team' }));
      const dialog = await sheet();
      expect(dialog.queryByRole('checkbox', { name: 'Cocaine' })).toBeNull();
      expect(dialog.queryByRole('group', { name: 'Cadaver' })).toBeNull();
    });

    it('Close discards the draft, and the next one opens empty', async () => {
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Team name'), 'Charlie');
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(await db.teams.count()).toBe(3);
      await userEvent.click(screen.getByRole('button', { name: '+ New team' }));
      const again = await sheet();
      expect(again.getByLabelText('Team name')).toHaveValue('');
      expect(again.getByRole('checkbox', { name: 'Cocaine' })).not.toBeChecked();
    });

    it('is the way out of the empty state for a trainer with no teams', async () => {
      await seedCatalogue(db, []);
      await db.meta.put({ key: ME_KEY, value: trainer });
      renderHome();
      await userEvent.click(await screen.findByRole('button', { name: '+ New team' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Team name'), 'First');
      await userEvent.click(dialog.getByRole('button', { name: 'Select all Bed bugs' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
      await waitFor(() => expect(screen.queryByText('No teams yet')).toBeNull());
      expect(await screen.findByRole('button', { name: /First/ })).toBeInTheDocument();
    });
  });
});
