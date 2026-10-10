import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import { BREEDS } from '../../src/domain/breeds';
import type { Member, Session } from '../../src/domain/types';
import { dogRow, seedCatalogue, team } from '../fixtures';
import { TeamDogsScreen } from '../../src/ui/screens/TeamDogsScreen';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { id: 'mH', unit_id: 'u1', user_id: 'uH', name: 'Paul', role: 'handler', joined_at: '', removed_at: null };
const manual = (id: string, dogId: string, odour: string, date: string, minutes: number): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mH', kind: 'manual', session_date: date,
  started_at: null, ended_at: null, duration_s: minutes * 60, client_clock_offset_s: null, server_received_at: null,
});
const running = (id: string, dogId: string): Session => ({
  ...manual(id, dogId, 'mdma', '2026-10-05', 0), kind: 'timed', duration_s: null,
  started_at: new Date(Date.now() - 724_000).toISOString(),
});

/** Alpha: Rex (Malinois, dual), Bella (Labrador, single), archived Old Max. Bravo: Fly. Retired (archived): Hidden. */
async function seed(me: Member) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.bulkPut([trainer, handler]);
  await seedCatalogue(db, ['t1', 't2']);
  await db.teams.update('t2', { name: 'Bravo' });
  await db.teams.put(team('t3', 'Retired', '2026-10-05T00:00:00Z'));
  await db.dogs.bulkPut([
    dogRow('d1', 'Rex', { breed: 'malinois', purpose: 'dual' }), dogRow('d2', 'Bella'),
    dogRow('d3', 'Old Max', { archived_at: '2026-10-02T00:00:00Z' }),
    dogRow('d4', 'Fly', { team_id: 't2' }), dogRow('d5', 'Hidden', { team_id: 't3' }),
  ]);
  await db.sessions.bulkPut([
    manual('s1', 'd1', 'cocaine', '2026-10-01', 75), manual('s2', 'd1', 'mdma', '2026-10-03', 42),
    manual('s3', 'd2', 'tnt', '2026-10-02', 18),
  ]);
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}
const renderTeam = (at = '/team/t1') => render(
  <MemoryRouter initialEntries={['/', at]} initialIndex={1}>
    <Routes>
      <Route path="/team/:teamId" element={<TeamDogsScreen />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const sheet = async () => within(await screen.findByRole('dialog'));

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('TeamDogsScreen', () => {
  it('is headed by the team name and goes back to the teams', async () => {
    await seed(trainer);
    renderTeam();
    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('lists only this team\'s active dogs, by name', async () => {
    await seed(trainer);
    renderTeam();
    await screen.findByRole('button', { name: /Rex/ });
    const names = screen.getAllByRole('listitem').map((li) => within(li).getByRole('button').textContent);
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/Bella/);
    expect(names[1]).toMatch(/Rex/);
    expect(screen.queryByText('Fly')).toBeNull(); // another team
    expect(screen.queryByText('Old Max')).toBeNull(); // archived
  });

  it('shows each dog with its breed drawing, "Breed · Purpose" and a progress line', async () => {
    await seed(trainer);
    renderTeam();
    const rex = within(await screen.findByRole('button', { name: /Rex/ }));
    expect(rex.getByText('Rex')).toBeInTheDocument();
    expect(rex.getByText('Malinois · Dual purpose')).toBeInTheDocument();
    expect(rex.getByText('MDMA 42/75 · Cocaine ✓')).toBeInTheDocument();
    const drawing = rex.getByRole('img', { name: 'Malinois' });
    expect(drawing).toHaveAttribute('src', `${import.meta.env.BASE_URL}breeds/malinois.webp`);
    expect(drawing.closest('[data-breed-portrait]')).toHaveAttribute('data-size', 'sm');
    expect(drawing.closest('[data-breed-portrait]')).toHaveAttribute('data-play', 'false');
    const bella = within(screen.getByRole('button', { name: /Bella/ }));
    expect(bella.getByText('Labrador · Single purpose')).toBeInTheDocument();
    expect(bella.getByText('TNT 18/75')).toBeInTheDocument();
  });

  it('says "Nothing logged yet" for a dog with no time', async () => {
    await seed(trainer);
    await db.sessions.clear();
    renderTeam();
    expect(within(await screen.findByRole('button', { name: /Rex/ })).getByText('Nothing logged yet')).toBeInTheDocument();
  });

  it('names the odours of a progress line and a running timer from the catalogue', async () => {
    await seed(trainer);
    await db.odours.update('mdma', { name: 'Ecstasy' });
    await db.sessions.put(running('r', 'd2'));
    renderTeam();
    expect(await screen.findByText('Ecstasy 42/75 · Cocaine ✓')).toBeInTheDocument();
    expect(await screen.findByText(/^Running · Bella · Ecstasy · /)).toBeInTheDocument();
  });

  it('opens the dog screen on tap', async () => {
    await seed(trainer);
    renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: /Rex/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1');
  });

  it('pins only this team\'s running timers at the top', async () => {
    await seed(trainer);
    await db.sessions.bulkPut([running('r1', 'd1'), running('r2', 'd4')]);
    renderTeam();
    expect(await screen.findByText(/^Running · Rex · MDMA · 12:0[4-9] · Paul$/)).toBeInTheDocument();
    expect(screen.queryByText(/Running · Fly/)).toBeNull();
  });

  it('sends you home when the team is archived or unknown', async () => {
    await seed(trainer);
    const { unmount } = renderTeam('/team/t3');
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
    unmount();
    renderTeam('/team/nope');
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('has an empty state that points a trainer to adding a dog', async () => {
    await seed(trainer);
    await db.dogs.clear();
    renderTeam();
    expect(await screen.findByText('No dogs yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first dog')).toBeInTheDocument();
  });

  it('has an empty state for a handler without the add prompt', async () => {
    await seed(handler);
    await db.dogs.clear();
    renderTeam();
    expect(await screen.findByText('No dogs yet')).toBeInTheDocument();
    expect(screen.queryByText('Add your first dog')).toBeNull();
  });

  describe('+ Add dog', () => {
    const open = async () => {
      await seed(trainer);
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: '+ Add dog' }));
      return sheet();
    };

    it('asks for name, breed and purpose, and nothing is chosen for you', async () => {
      const dialog = await open();
      expect(dialog.getByLabelText('Dog name')).toHaveValue('');
      const breeds = within(dialog.getByRole('group', { name: 'Breed' })).getAllByRole('button');
      expect(breeds.map((b) => b.textContent)).toEqual(BREEDS.map((b) => b.label));
      for (const b of breeds) expect(b).toHaveAttribute('aria-pressed', 'false');
      const purposes = within(dialog.getByRole('group', { name: 'Purpose' })).getAllByRole('button');
      expect(purposes.map((b) => b.textContent)).toEqual(['Single purpose', 'Dual purpose']);
      for (const p of purposes) expect(p).toHaveAttribute('aria-pressed', 'false');
      expect(dialog.queryByLabelText('Team')).toBeNull(); // the team is the one you are in
      expect(dialog.getByRole('button', { name: 'Add dog' })).toBeDisabled();
    });

    it('stays disabled until the name, a breed and a purpose are all given', async () => {
      const dialog = await open();
      const save = dialog.getByRole('button', { name: 'Add dog' });
      await userEvent.type(dialog.getByLabelText('Dog name'), 'Ziggy');
      expect(save).toBeDisabled();
      await userEvent.click(dialog.getByRole('button', { name: 'Hound' }));
      expect(save).toBeDisabled();
      await userEvent.click(dialog.getByRole('button', { name: 'Dual purpose' }));
      expect(save).toBeEnabled();
      await userEvent.clear(dialog.getByLabelText('Dog name'));
      expect(save).toBeDisabled();
    });

    it('shows the chosen breed large, and marks only it as pressed', async () => {
      const dialog = await open();
      expect(dialog.queryByRole('img', { name: 'Springer Spaniel' })).toBeNull();
      await userEvent.click(dialog.getByRole('button', { name: 'Springer Spaniel' }));
      expect(dialog.getByRole('button', { name: 'Springer Spaniel' })).toHaveAttribute('aria-pressed', 'true');
      expect(dialog.getByRole('button', { name: 'Hound' })).toHaveAttribute('aria-pressed', 'false');
      const portrait = dialog.getByRole('img', { name: 'Springer Spaniel' }).closest('[data-breed-portrait]')!;
      expect(portrait).toHaveAttribute('data-size', 'lg');
      expect(portrait).toHaveAttribute('data-play', 'true'); // plays on every choice
      await userEvent.click(dialog.getByRole('button', { name: 'Labrador' }));
      expect(dialog.queryByRole('img', { name: 'Springer Spaniel' })).toBeNull();
      expect(dialog.getByRole('img', { name: 'Labrador' })).toBeInTheDocument();
    });

    it('adds the dog to this team with the chosen breed and purpose, through the outbox', async () => {
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Dog name'), '  Ziggy ');
      await userEvent.click(dialog.getByRole('button', { name: 'Bloodhound' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Single purpose' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Add dog' }));
      expect(await screen.findByRole('button', { name: /Ziggy/ })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(await db.dogs.filter((d) => d.name === 'Ziggy').first())
        .toMatchObject({ team_id: 't1', breed: 'bloodhound', purpose: 'single' });
      expect((await db.outbox.toArray()).map((i) => `${i.table}:${i.op}`)).toEqual(['dogs:insert']);
      expect(within(screen.getByRole('button', { name: /Ziggy/ })).getByText('Bloodhound · Single purpose')).toBeInTheDocument();
    });

    it('opens empty again after a dog was added', async () => {
      const dialog = await open();
      await userEvent.type(dialog.getByLabelText('Dog name'), 'Ziggy');
      await userEvent.click(dialog.getByRole('button', { name: 'Hound' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Single purpose' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Add dog' }));
      await screen.findByRole('button', { name: /Ziggy/ });
      await userEvent.click(screen.getByRole('button', { name: '+ Add dog' }));
      const again = await sheet();
      expect(again.getByLabelText('Dog name')).toHaveValue('');
      expect(again.getByRole('button', { name: 'Hound' })).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('sends you home if the team is archived while you are looking at it', async () => {
    await seed(trainer);
    renderTeam();
    await screen.findByRole('button', { name: /Rex/ });
    await db.teams.update('t1', { archived_at: '2026-10-09T00:00:00Z' }); // done on another phone
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('gives a handler the dogs and nothing to change', async () => {
    await seed(handler);
    renderTeam();
    await screen.findByRole('button', { name: /Rex/ });
    expect(screen.queryByRole('button', { name: '+ Add dog' })).toBeNull();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
  });
});
