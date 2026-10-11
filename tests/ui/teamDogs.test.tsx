import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import { BREEDS } from '../../src/domain/breeds';
import type { Member, Session } from '../../src/domain/types';
import { dogRow, meRecord, seedCatalogue, team } from '../fixtures';
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
  await db.meta.put({ key: ME_KEY, value: meRecord(me) });
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

  describe('the dog count', () => {
    it('says "2 of 6 dogs" when the team has a planned size, counting only active dogs', async () => {
      await seed(trainer);
      await db.teams.update('t1', { planned_dogs: 6 }); // Rex and Bella; the archived Old Max is not counted
      renderTeam();
      expect(await screen.findByText('2 of 6 dogs')).toBeInTheDocument();
      expect(screen.queryByText('2 dogs')).toBeNull();
    });

    it('draws the dots, counts the team\'s odours and says how many places are left', async () => {
      await seed(trainer);
      await db.teams.update('t1', { planned_dogs: 6 });
      renderTeam();
      const dots = await screen.findByTestId('capacity-dots');
      expect(dots.querySelectorAll('.dot-filled')).toHaveLength(2);
      expect(dots.querySelectorAll('.dot:not(.dot-filled)')).toHaveLength(4);
      expect(screen.getByText('Four more places in this team.')).toBeInTheDocument();
      expect(screen.getByText(/^\d+ odours?$/)).toBeInTheDocument();
    });

    it('has no dots and no places-left line for a team with no planned size', async () => {
      await seed(trainer);
      renderTeam();
      await screen.findByText('2 dogs');
      expect(screen.queryByTestId('capacity-dots')).toBeNull();
      expect(screen.queryByText(/more places? in this team/)).toBeNull();
    });

    it('says "2 dogs" for a team with no planned size, and "1 dog" for one dog', async () => {
      await seed(trainer);
      renderTeam();
      expect(await screen.findByText('2 dogs')).toBeInTheDocument();
      expect(screen.queryByText(/ of /)).toBeNull();
      renderTeam('/team/t2');
      expect(await screen.findByText('1 dog')).toBeInTheDocument();
    });

    it('has the right singular on either side, and shows the plan for a team with no dogs yet', async () => {
      await seed(trainer);
      await db.teams.update('t2', { planned_dogs: 1 });
      await db.teams.put(team('t9', 'Empty', null, 'u1', 4));
      renderTeam('/team/t2');
      expect(await screen.findByText('1 of 1 dog')).toBeInTheDocument();
      renderTeam('/team/t9');
      expect(await screen.findByText('0 of 4 dogs')).toBeInTheDocument();
      expect(screen.getByText('No dogs yet')).toBeInTheDocument();
    });

    it('treats a team stored before the field existed (no such key) as having no planned size', async () => {
      await seed(trainer);
      const old: Partial<ReturnType<typeof team>> = team('t9', 'Ancient');
      delete old.planned_dogs;
      await db.teams.put(old as ReturnType<typeof team>);
      renderTeam('/team/t9');
      expect(await screen.findByText('0 dogs')).toBeInTheDocument();
    });

    it('follows a dog being added or archived, and a size changed on another phone', async () => {
      await seed(trainer);
      await db.teams.update('t1', { planned_dogs: 6 });
      renderTeam();
      expect(await screen.findByText('2 of 6 dogs')).toBeInTheDocument();
      await db.dogs.put(dogRow('d9', 'Newbie'));
      expect(await screen.findByText('3 of 6 dogs')).toBeInTheDocument();
      await db.dogs.update('d9', { archived_at: '2026-10-09T00:00:00Z' });
      expect(await screen.findByText('2 of 6 dogs')).toBeInTheDocument();
      await db.teams.update('t1', { planned_dogs: 8 });
      expect(await screen.findByText('2 of 8 dogs')).toBeInTheDocument();
    });

    it('shows a handler the same text, with no control to change it', async () => {
      await seed(handler);
      await db.teams.update('t1', { planned_dogs: 6 });
      renderTeam();
      expect(await screen.findByText('2 of 6 dogs')).toBeInTheDocument();
      expect(screen.queryByLabelText('Number of dogs')).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('button', { name: /number of dogs/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
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

  it('shows each dog with its breed drawing, breed, purpose, an IMPRINTED stamp and a status line', async () => {
    await seed(trainer);
    renderTeam();
    const rex = within(await screen.findByRole('button', { name: /Rex/ }));
    expect(rex.getByText('Rex')).toBeInTheDocument();
    expect(rex.getByText('Malinois')).toBeInTheDocument();
    expect(rex.getByText('dual purpose')).toBeInTheDocument();
    expect(rex.getByText('1 imprinted')).toBeInTheDocument(); // Cocaine is at 75
    expect(rex.getByText('MDMA 42:00')).toBeInTheDocument();
    const drawing = rex.getByRole('img', { name: 'Malinois' });
    expect(drawing).toHaveAttribute('src', `${import.meta.env.BASE_URL}breeds/malinois.webp`);
    expect(drawing.closest('[data-breed-portrait]')).toHaveAttribute('data-size', 'sm');
    expect(drawing.closest('[data-breed-portrait]')).toHaveAttribute('data-play', 'false');
    const bella = within(screen.getByRole('button', { name: /Bella/ }));
    expect(bella.getByText('Labrador')).toBeInTheDocument();
    expect(bella.getByText('single purpose')).toBeInTheDocument();
    expect(bella.getByText('TNT 18:00')).toBeInTheDocument();
    expect(bella.queryByText(/imprinted/)).toBeNull();
  });

  it('says "Nothing logged yet" for a dog with no time', async () => {
    await seed(trainer);
    await db.sessions.clear();
    renderTeam();
    expect(within(await screen.findByRole('button', { name: /Rex/ })).getByText('Nothing logged yet')).toBeInTheDocument();
  });

  it('names the odours of a status line and a running timer from the catalogue', async () => {
    await seed(trainer);
    await db.odours.update('mdma', { name: 'Ecstasy' });
    await db.sessions.put(running('r', 'd2'));
    renderTeam();
    expect(await screen.findByText('Ecstasy 42:00')).toBeInTheDocument();
    expect(await screen.findByText(/^Running 12:0[4-9] · Ecstasy$/)).toBeInTheDocument();
  });

  it('opens the dog screen on tap', async () => {
    await seed(trainer);
    renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: /Rex/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1');
  });

  it('tags only this team\'s running dogs, with the time and the odour', async () => {
    await seed(trainer);
    await db.sessions.bulkPut([running('r1', 'd1'), running('r2', 'd4')]);
    renderTeam();
    const rex = within(await screen.findByRole('button', { name: /Rex/ }));
    expect(await rex.findByText(/^Running 12:0[4-9] · MDMA$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Running /)).toHaveLength(1); // Fly runs in another team
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

    it('replays the drawing on every choice, including tapping the breed that is already chosen', async () => {
      const dialog = await open();
      await userEvent.click(dialog.getByRole('button', { name: 'Hound' }));
      const stageOf = (name: string) => dialog.getByRole('img', { name }).closest('[data-stage]');
      const first = stageOf('Hound');
      expect(first).not.toBeNull();
      await userEvent.click(dialog.getByRole('button', { name: 'Hound' }));
      const again = stageOf('Hound');
      expect(again).not.toBe(first);
      await userEvent.click(dialog.getByRole('button', { name: 'Bloodhound' }));
      expect(dialog.getByRole('img', { name: 'Bloodhound' }).closest('[data-breed-portrait]')).toHaveAttribute('data-motion', 'animated');
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
      const ziggy = within(screen.getByRole('button', { name: /Ziggy/ }));
      expect(ziggy.getByText('Bloodhound')).toBeInTheDocument();
      expect(ziggy.getByText('single purpose')).toBeInTheDocument();
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

  describe('team settings', () => {
    const open = async () => {
      await seed(trainer);
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
      return sheet();
    };

    it('opens from the header with the team name, its odour count and Archive', async () => {
      const dialog = await open();
      expect(dialog.getByLabelText('Team name')).toHaveValue('Alpha');
      expect(dialog.getByText('20 odours selected')).toBeInTheDocument();
      expect(dialog.getByRole('button', { name: 'Choose odours' })).toBeInTheDocument();
      expect(dialog.getByRole('button', { name: 'Archive team' })).toBeInTheDocument();
    });

    it('renames the team', async () => {
      const dialog = await open();
      const save = dialog.getByRole('button', { name: 'Save name' });
      const field = dialog.getByLabelText('Team name');
      expect(save).toBeDisabled(); // unchanged
      await userEvent.clear(field);
      expect(save).toBeDisabled();
      await userEvent.type(field, 'Alpha Two');
      await userEvent.click(save);
      expect(await screen.findByRole('heading', { level: 1, name: 'Alpha Two' })).toBeInTheDocument();
      expect((await db.outbox.toArray()).map((i) => i.row)).toEqual([{ id: 't1', name: 'Alpha Two' }]);
    });

    describe('Number of dogs', () => {
      const MESSAGE = 'Enter a whole number, 1 or more.';

      it('is filled with the planned size, and Save waits for a change', async () => {
        await seed(trainer);
        await db.teams.update('t1', { planned_dogs: 6 });
        renderTeam();
        await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
        const dialog = await sheet();
        const field = dialog.getByLabelText('Number of dogs');
        expect(field).toHaveValue('6');
        expect(field).toHaveAttribute('inputmode', 'numeric');
        expect(dialog.getByRole('button', { name: 'Save number of dogs' })).toBeDisabled();
        await userEvent.type(field, '0');
        expect(dialog.getByRole('button', { name: 'Save number of dogs' })).toBeEnabled();
      });

      it('changes the size: a one-field update through the outbox, then the screen shows it', async () => {
        await seed(trainer);
        await db.teams.update('t1', { planned_dogs: 6 });
        renderTeam();
        await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
        const dialog = await sheet();
        await userEvent.clear(dialog.getByLabelText('Number of dogs'));
        await userEvent.type(dialog.getByLabelText('Number of dogs'), '9');
        await userEvent.click(dialog.getByRole('button', { name: 'Save number of dogs' }));
        expect(await screen.findByText('2 of 9 dogs')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect((await db.teams.get('t1'))!.planned_dogs).toBe(9);
        expect((await db.outbox.toArray()).map((i) => [i.table, i.op, i.row])).toEqual([['teams', 'update', { id: 't1', planned_dogs: 9 }]]);
        expect(await db.dogs.count()).toBe(5); // a plan only: no dog was added
      });

      it('gives a team from before the number was asked for a size: the field starts empty', async () => {
        await seed(trainer); // Alpha has no planned size
        renderTeam();
        expect(await screen.findByText('2 dogs')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
        const dialog = await sheet();
        expect(dialog.getByLabelText('Number of dogs')).toHaveValue('');
        expect(dialog.getByRole('button', { name: 'Save number of dogs' })).toBeDisabled();
        await userEvent.type(dialog.getByLabelText('Number of dogs'), '5');
        await userEvent.click(dialog.getByRole('button', { name: 'Save number of dogs' }));
        expect(await screen.findByText('2 of 5 dogs')).toBeInTheDocument();
        expect((await db.teams.get('t1'))!.planned_dogs).toBe(5);
      });

      it.each([
        ['empty', ''], ['zero', '0'], ['negative', '-2'], ['a decimal', '2.5'], ['words', 'abc'], ['digits and words', '4 dogs'],
      ])('%s: shows the message and saves nothing', async (_what, text) => {
        await seed(trainer);
        await db.teams.update('t1', { planned_dogs: 6 });
        renderTeam();
        await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
        const dialog = await sheet();
        const field = dialog.getByLabelText('Number of dogs');
        await userEvent.clear(field);
        if (text) await userEvent.type(field, text);
        await userEvent.click(dialog.getByRole('button', { name: 'Save number of dogs' }));
        expect(dialog.getByRole('alert')).toHaveTextContent(MESSAGE);
        expect(field).toBeInvalid();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect((await db.teams.get('t1'))!.planned_dogs).toBe(6);
        expect(await db.outbox.count()).toBe(0);
      });

      it('the message goes away once the number is right', async () => {
        await seed(trainer);
        await db.teams.update('t1', { planned_dogs: 6 });
        renderTeam();
        await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
        const dialog = await sheet();
        await userEvent.clear(dialog.getByLabelText('Number of dogs'));
        await userEvent.type(dialog.getByLabelText('Number of dogs'), '0');
        expect(dialog.getByText(MESSAGE)).toBeInTheDocument();
        await userEvent.clear(dialog.getByLabelText('Number of dogs'));
        await userEvent.type(dialog.getByLabelText('Number of dogs'), '3');
        expect(dialog.queryByText(MESSAGE)).toBeNull();
      });

      it('is not touched by saving the name, and the name is not touched by saving the number', async () => {
        await seed(trainer);
        await db.teams.update('t1', { planned_dogs: 6 });
        renderTeam();
        await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
        const dialog = await sheet();
        await userEvent.type(dialog.getByLabelText('Team name'), ' Two');
        await userEvent.click(dialog.getByRole('button', { name: 'Save name' }));
        await screen.findByRole('heading', { level: 1, name: 'Alpha Two' });
        expect((await db.outbox.toArray()).map((i) => i.row)).toEqual([{ id: 't1', name: 'Alpha Two' }]);
        expect((await db.teams.get('t1'))!.planned_dogs).toBe(6);
      });
    });

    it('changes the odours the team trains on', async () => {
      const dialog = await open();
      await userEvent.click(dialog.getByRole('button', { name: 'Choose odours' }));
      expect(dialog.getByRole('checkbox', { name: 'Cocaine' })).toBeChecked();
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Select all Cadaver' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Save odours' }));
      expect(await dialog.findByLabelText('Team name')).toBeInTheDocument(); // back on the settings view
      expect(dialog.getByText('18 odours selected')).toBeInTheDocument();
      expect((await db.team_odours.get('t1:cocaine'))!.selected).toBe(false);
      expect((await db.team_odours.get('t1:human-remains'))!.selected).toBe(false); // it was ticked, so "Select all" cleared it
      expect((await db.outbox.toArray()).map((i) => `${i.table}:${i.op}`)).toEqual(['team_odours:update', 'team_odours:update']);
    });

    it('needs at least one odour', async () => {
      const dialog = await open();
      await userEvent.click(dialog.getByRole('button', { name: 'Choose odours' }));
      for (const c of ['Narcotics', 'Explosives', 'Cadaver', 'Bed bugs']) {
        await userEvent.click(dialog.getByRole('button', { name: `Select all ${c}` }));
      }
      expect(dialog.getByRole('button', { name: 'Save odours' })).toBeDisabled();
      expect(dialog.getByText('Pick at least one odour')).toBeInTheDocument();
      await userEvent.click(dialog.getByRole('checkbox', { name: 'MDMA' }));
      expect(dialog.getByRole('button', { name: 'Save odours' })).toBeEnabled();
    });

    it('goes back from the odours without saving', async () => {
      const dialog = await open();
      await userEvent.click(dialog.getByRole('button', { name: 'Choose odours' }));
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Back to settings' }));
      expect(dialog.getByText('20 odours selected')).toBeInTheDocument();
      expect(await db.outbox.count()).toBe(0);
    });

    it('asks before archiving, and Cancel keeps the team', async () => {
      const dialog = await open();
      await userEvent.click(dialog.getByRole('button', { name: 'Archive team' }));
      expect(dialog.getByText(
        'Archive Alpha? It and its dogs disappear for everyone; you can restore it from Archived.',
      )).toBeInTheDocument();
      expect((await db.teams.get('t1'))!.archived_at).toBeNull(); // one tap did not archive
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(dialog.getByLabelText('Team name')).toBeInTheDocument(); // back on the settings view
      expect((await db.teams.get('t1'))!.archived_at).toBeNull();
    });

    it('archives on confirm and returns to the teams', async () => {
      const dialog = await open();
      await userEvent.click(dialog.getByRole('button', { name: 'Archive team' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Archive Alpha' }));
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
      expect((await db.teams.get('t1'))!.archived_at).not.toBeNull();
      expect((await db.outbox.toArray()).map((i) => `${i.table}:${i.op}`)).toEqual(['teams:update']);
    });

    it('will not archive while a timer runs on one of its dogs', async () => {
      await seed(trainer);
      await db.sessions.put(running('r', 'd1'));
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
      const dialog = await sheet();
      await userEvent.click(dialog.getByRole('button', { name: 'Archive team' }));
      expect(dialog.getByRole('alert')).toHaveTextContent('Stop the running timer before archiving');
      expect(dialog.queryByRole('button', { name: 'Archive Alpha' })).toBeNull();
      expect((await db.teams.get('t1'))!.archived_at).toBeNull();
    });

    it('a timer on another team does not stop this team being archived', async () => {
      await seed(trainer);
      await db.sessions.put(running('r', 'd4')); // Fly, in Bravo
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
      const dialog = await sheet();
      await userEvent.click(dialog.getByRole('button', { name: 'Archive team' }));
      expect(dialog.getByRole('button', { name: 'Archive Alpha' })).toBeInTheDocument();
    });
  });

  describe('Archive team, on the screen itself', () => {
    it('is offered to a trainer without opening Settings, and asks before archiving', async () => {
      await seed(trainer);
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive team' }));
      const dialog = await sheet();
      expect(dialog.getByRole('heading', { name: 'Archive team' })).toBeInTheDocument();
      expect(dialog.getByText(
        'Archive Alpha? It and its dogs disappear for everyone; you can restore it from Archived.',
      )).toBeInTheDocument();
      expect((await db.teams.get('t1'))!.archived_at).toBeNull();
    });

    it('Cancel closes the question and keeps the team', async () => {
      await seed(trainer);
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive team' }));
      await userEvent.click((await sheet()).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect((await db.teams.get('t1'))!.archived_at).toBeNull();
      expect(await db.outbox.count()).toBe(0);
    });

    it('archives on confirm and returns to the teams', async () => {
      await seed(trainer);
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive team' }));
      await userEvent.click((await sheet()).getByRole('button', { name: 'Archive Alpha' }));
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
      expect((await db.teams.get('t1'))!.archived_at).not.toBeNull();
      expect((await db.outbox.toArray()).map((i) => `${i.table}:${i.op}`)).toEqual(['teams:update']);
    });

    it('will not archive while a timer runs on one of its dogs, and says why', async () => {
      await seed(trainer);
      await db.sessions.put(running('r', 'd1'));
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive team' }));
      const dialog = await sheet();
      expect(dialog.getByRole('alert')).toHaveTextContent('Stop the running timer before archiving');
      expect(dialog.getByRole('button', { name: 'Archive Alpha' })).toBeDisabled();
      expect((await db.teams.get('t1'))!.archived_at).toBeNull();
    });

    it('opens Settings on its own view afterwards, not on the archive question', async () => {
      await seed(trainer);
      renderTeam();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive team' }));
      await userEvent.click((await sheet()).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect((await sheet()).getByLabelText('Team name')).toBeInTheDocument();
    });
  });

  it('gives a handler the dogs and nothing to change', async () => {
    await seed(handler);
    renderTeam();
    await screen.findByRole('button', { name: /Rex/ });
    expect(screen.queryByRole('button', { name: '+ Add dog' })).toBeNull();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /archive/i })).toBeNull();
  });
});
