import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import type { Member, Session } from '../../src/domain/types';
import { dogRow, meRecord, seedCatalogue, team } from '../fixtures';
import { TeamsScreen } from '../../src/ui/screens/TeamsScreen';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: null, name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { id: 'mH', unit_id: 'u1', user_id: null, name: 'Paul', role: 'handler', joined_at: '', removed_at: null };
const running = (id: string, dogId: string, odour: string): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mH', kind: 'timed', session_date: '2026-10-05',
  started_at: new Date(Date.now() - 724_000).toISOString(), ended_at: null, duration_s: null,
  client_clock_offset_s: null, server_received_at: null,
});

/** Alpha: Rex, Bella (and an archived Old Max). Bravo: Fly. Retired (archived team): Hidden. */
async function seed(me: Member) {
  await db.meta.put({ key: ME_KEY, value: meRecord(me) });
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

  describe('the dog count on a card', () => {
    it('says "2 of 6 dogs" when the team has a planned size, and "2 dogs" when it has none', async () => {
      await seed(trainer);
      await db.teams.update('t1', { planned_dogs: 6 });
      renderHome();
      const alpha = await screen.findByRole('button', { name: /Alpha/ });
      expect(within(alpha).getByText('2 of 6 dogs')).toBeInTheDocument(); // the archived Old Max is not counted
      const bravo = screen.getByRole('button', { name: /Bravo/ }); // a team from before the number was asked for
      expect(within(bravo).getByText('1 dog')).toBeInTheDocument();
      expect(within(bravo).queryByText(/ of /)).toBeNull();
    });

    it('treats a team stored before the field existed (no such key at all) as having none', async () => {
      await seed(trainer);
      const { planned_dogs: _gone, ...old } = team('t9', 'Ancient');
      await db.teams.put(old as ReturnType<typeof team>);
      renderHome();
      expect(within(await screen.findByRole('button', { name: /Ancient/ })).getByText('0 dogs')).toBeInTheDocument();
    });

    it('gets the singular right on either side: "1 of 1 dog", "0 of 4 dogs", "1 of 4 dogs"', async () => {
      await seed(trainer);
      await db.teams.update('t2', { planned_dogs: 1 });
      await db.teams.put(team('t8', 'Delta', null, 'u1', 4));
      await db.teams.put(team('t7', 'Echo', null, 'u1', 4));
      await db.dogs.put(dogRow('d7', 'Zed', { team_id: 't7' }));
      renderHome();
      expect(within(await screen.findByRole('button', { name: /Bravo/ })).getByText('1 of 1 dog')).toBeInTheDocument();
      expect(within(screen.getByRole('button', { name: /Delta/ })).getByText('0 of 4 dogs')).toBeInTheDocument();
      expect(within(screen.getByRole('button', { name: /Echo/ })).getByText('1 of 4 dogs')).toBeInTheDocument();
    });

    it('does not count archived dogs, and follows a dog being archived', async () => {
      await seed(trainer);
      await db.teams.update('t1', { planned_dogs: 6 });
      renderHome();
      const alpha = await screen.findByRole('button', { name: /Alpha/ });
      expect(within(alpha).getByText('2 of 6 dogs')).toBeInTheDocument();
      await db.dogs.update('d2', { archived_at: '2026-10-09T00:00:00Z' });
      expect(await within(alpha).findByText('1 of 6 dogs')).toBeInTheDocument();
    });

    it('shows a handler the same text, with nothing to change it', async () => {
      await seed(handler);
      await db.teams.update('t1', { planned_dogs: 6 });
      renderHome();
      const alpha = await screen.findByRole('button', { name: /Alpha/ });
      expect(within(alpha).getByText('2 of 6 dogs')).toBeInTheDocument();
      expect(within(screen.getByRole('button', { name: /Bravo/ })).getByText('1 dog')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /new team/i })).toBeNull();
      expect(screen.queryByLabelText('Number of dogs')).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
    });
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
    await db.meta.put({ key: ME_KEY, value: meRecord(trainer) });
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
    // the team cards, and the control that says who is using the phone
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Paul · Switch', expect.stringContaining('Alpha'), expect.stringContaining('Bravo'),
    ]);
  });

  it('has an empty state for a handler too', async () => {
    await db.meta.put({ key: ME_KEY, value: meRecord(handler) });
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
      await userEvent.type(dialog.getByLabelText('Number of dogs'), '5');
      await userEvent.click(dialog.getByRole('button', { name: 'Select all Cadaver' }));
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
      const card = await screen.findByRole('button', { name: /Charlie/ });
      expect(within(card).getByText('0 of 5 dogs')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
      const made = (await db.teams.toArray()).find((t) => t.name === 'Charlie')!;
      const picks = await db.team_odours.where('team_id').equals(made.id).toArray();
      expect(picks.filter((p) => p.selected).map((p) => p.odour_id).sort()).toEqual(['cocaine', 'human-remains']);
      expect((await db.outbox.toArray()).map((i) => i.table)).toEqual(['teams', 'team_odours', 'team_odours']);
    });

    describe('Number of dogs', () => {
      const MESSAGE = 'Enter a whole number, 1 or more.';
      const fill = async (dialog: Awaited<ReturnType<typeof sheet>>, dogs: string) => {
        await userEvent.type(dialog.getByLabelText('Team name'), 'Charlie');
        if (dogs) await userEvent.type(dialog.getByLabelText('Number of dogs'), dogs);
        await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
      };

      it('is a labelled, required field with the numeric keypad, empty at first, and says it adds no dogs', async () => {
        const dialog = await open();
        const field = dialog.getByLabelText('Number of dogs');
        expect(field).toHaveValue('');
        expect(field).toHaveAttribute('inputmode', 'numeric');
        expect(field).toBeRequired();
        expect(dialog.getByText(/does not add dogs/i)).toBeInTheDocument();
        expect(dialog.queryByText(MESSAGE)).toBeNull(); // no scolding before anything was tried
        const order = [dialog.getByLabelText('Team name'), field, dialog.getByRole('checkbox', { name: 'Cocaine' })];
        for (let i = 1; i < order.length; i++) {
          expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
      });

      it.each([
        ['empty', ''], ['zero', '0'], ['several zeros', '000'], ['negative', '-1'], ['a minus alone', '-'],
        ['a decimal', '2.5'], ['a decimal comma', '2,5'], ['words', 'abc'], ['digits and words', '3 dogs'],
        ['an exponent', '1e2'], ['a plus sign', '+3'], ['too big for the database', '2147483648'],
      ])('%s: shows the message and does not create the team', async (_what, text) => {
        const dialog = await open();
        await fill(dialog, text);
        await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
        expect(dialog.getByRole('alert')).toHaveTextContent(MESSAGE);
        expect(dialog.getByLabelText('Number of dogs')).toBeInvalid();
        expect(screen.getByRole('dialog')).toBeInTheDocument(); // still open
        expect(await db.teams.count()).toBe(3); // the seed's three, nothing new
        expect(await db.outbox.count()).toBe(0);
      });

      it('shows the message as soon as what was typed cannot be right, and takes it away once it is fixed', async () => {
        const dialog = await open();
        await fill(dialog, '0');
        expect(dialog.getByText(MESSAGE)).toBeInTheDocument(); // without tapping Create team
        await userEvent.clear(dialog.getByLabelText('Number of dogs'));
        await userEvent.type(dialog.getByLabelText('Number of dogs'), '4');
        expect(dialog.queryByText(MESSAGE)).toBeNull();
        expect(dialog.getByLabelText('Number of dogs')).toBeValid();
      });

      it('after a failed attempt on an empty field, keeps the message until a number is there', async () => {
        const dialog = await open();
        await fill(dialog, '');
        await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
        expect(dialog.getByText(MESSAGE)).toBeInTheDocument();
        await userEvent.type(dialog.getByLabelText('Number of dogs'), '2');
        expect(dialog.queryByText(MESSAGE)).toBeNull();
        await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
        expect(await screen.findByRole('button', { name: /Charlie/ })).toBeInTheDocument();
      });

      it('creates the team with the number (spaces around it are fine), shows "0 of N dogs", and adds no dogs', async () => {
        const dialog = await open();
        await fill(dialog, ' 12 ');
        await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
        expect(within(await screen.findByRole('button', { name: /Charlie/ })).getByText('0 of 12 dogs')).toBeInTheDocument();
        const made = (await db.teams.toArray()).find((t) => t.name === 'Charlie')!;
        expect(made.planned_dogs).toBe(12);
        expect((await db.outbox.orderBy('seq').first())!.row).toMatchObject({ id: made.id, name: 'Charlie', planned_dogs: 12 });
        expect(await db.dogs.count()).toBe(5); // the seed's dogs only
      });

      it('does not make Create team wait for the number: name and odours still decide that', async () => {
        const dialog = await open();
        await userEvent.type(dialog.getByLabelText('Team name'), 'Charlie');
        expect(dialog.getByRole('button', { name: 'Create team' })).toBeDisabled();
        await userEvent.click(dialog.getByRole('checkbox', { name: 'Cocaine' }));
        expect(dialog.getByRole('button', { name: 'Create team' })).toBeEnabled();
      });

      it('Close discards what was typed, and the next sheet opens empty', async () => {
        const dialog = await open();
        await fill(dialog, '7');
        await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
        await userEvent.click(screen.getByRole('button', { name: '+ New team' }));
        expect((await sheet()).getByLabelText('Number of dogs')).toHaveValue('');
      });
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
      await db.meta.put({ key: ME_KEY, value: meRecord(trainer) });
      renderHome();
      await userEvent.click(await screen.findByRole('button', { name: '+ New team' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Team name'), 'First');
      await userEvent.type(dialog.getByLabelText('Number of dogs'), '3');
      await userEvent.click(dialog.getByRole('button', { name: 'Select all Bed bugs' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Create team' }));
      await waitFor(() => expect(screen.queryByText('No teams yet')).toBeNull());
      expect(await screen.findByRole('button', { name: /First/ })).toBeInTheDocument();
    });
  });
});

describe('Switch (who is using this phone)', () => {
  const stored = async () => (await db.meta.get(ME_KEY))?.value;

  it('shows the name this phone is signed in under, with a Switch control that is easy to hit', async () => {
    await seed(handler);
    renderHome();
    const control = await screen.findByRole('button', { name: 'Paul · Switch' });
    expect(parseInt(control.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('is there for a trainer too', async () => {
    await seed(trainer);
    renderHome();
    expect(await screen.findByRole('button', { name: 'Tess · Switch' })).toBeInTheDocument();
  });

  it('Switch forgets the name here, keeps the unit and the link’s scope, and leaves the data alone', async () => {
    await seed(handler);
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Paul · Switch' }));
    await waitFor(async () => expect(await stored()).toEqual({ unit_id: 'u1', scope: 'handler', member_id: null }));
    expect(await db.dogs.count()).toBe(5);
  });

  it('with work still waiting to be sent, asks first: Stay as Paul changes nothing', async () => {
    await seed(handler);
    await db.outbox.add({ table: 'sessions', op: 'insert', row: { id: 's9' }, created_at: '2026-10-05T10:00:00Z', status: 'pending' });
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Paul · Switch' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Paul still has 1 unsent item on this phone/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Stay as Paul' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await stored()).toEqual({ unit_id: 'u1', scope: 'handler', member_id: 'mH' });
  });

  it('... and Switch anyway switches', async () => {
    await seed(handler);
    await db.outbox.add({ table: 'sessions', op: 'insert', row: { id: 's9' }, created_at: '2026-10-05T10:00:00Z', status: 'pending' });
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Paul · Switch' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Switch anyway' }));
    await waitFor(async () => expect(await stored()).toEqual({ unit_id: 'u1', scope: 'handler', member_id: null }));
    expect(await db.outbox.count()).toBe(1); // still waiting, not thrown away
  });
});

