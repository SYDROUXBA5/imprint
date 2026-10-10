// A handler can do two things: choose a dog and add time (spec §13.5). Every control a handler must not see
// and every route a handler must not reach has a test here, each next to a trainer check so that a test
// cannot pass just because the screen is empty.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dogRow, seedCatalogue, team } from '../fixtures';
import type { Member, Session } from '../../src/domain/types';

vi.mock('../../src/data/supabase', () => ({ supabase: { rpc: vi.fn() } }));

const { db, ME_KEY } = await import('../../src/data/db');
const { AppRoutes } = await import('../../src/App');

const tess: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const paul: Member = { ...tess, id: 'mP', user_id: 'uP', name: 'Paul', role: 'handler' };
const manual = (id: string, dogId: string, odour: string, minutes: number): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mP', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: minutes * 60, client_clock_offset_s: null, server_received_at: null,
});

/** Alpha: Rex. Retired (archived team): Scout. Archived dog Old Max in Alpha. */
async function seed(me: Member) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.bulkPut([tess, paul]);
  await db.units.put({ id: 'u1', name: 'Border K9', invite_code: 'K7M2QX', created_at: '2026-10-01T00:00:00Z' });
  await seedCatalogue(db);
  await db.teams.put(team('t9', 'Retired', '2026-10-06T10:00:00Z'));
  await db.dogs.bulkPut([
    dogRow('d1', 'Rex', { breed: 'malinois', purpose: 'dual' }),
    dogRow('d2', 'Old Max', { archived_at: '2026-10-02T00:00:00Z' }),
    dogRow('d9', 'Scout', { team_id: 't9' }),
  ]);
  await db.sessions.bulkPut([manual('s1', 'd1', 'mdma', 42)]);
}
/** Sign in as `me` (the screens read who I am from the local store) and open the app at `at`. */
async function renderAt(me: Member, at: string) {
  await db.meta.put({ key: ME_KEY, value: me });
  return render(<MemoryRouter initialEntries={[at]}><AppRoutes me={me} /></MemoryRouter>);
}
const homeHeading = () => screen.findByRole('heading', { level: 1, name: 'Teams' });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('a handler: hidden controls', () => {
  it('home: no Members, Odours or Archived links', async () => {
    await seed(tess);
    const { unmount } = await renderAt(tess, '/');
    await screen.findByRole('link', { name: 'Members' });
    expect(screen.getByRole('link', { name: 'Odours' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Archived/ })).toBeInTheDocument();
    unmount();

    await renderAt(paul, '/');
    await screen.findByRole('button', { name: /Alpha/ });
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Odours' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Archived/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Team$/ })).toBeNull();
  });

  it('team: no "+ Add dog"', async () => {
    await seed(tess);
    const { unmount } = await renderAt(tess, '/team/t1');
    expect(await screen.findByRole('button', { name: '+ Add dog' })).toBeInTheDocument();
    unmount();

    await renderAt(paul, '/team/t1');
    await screen.findByRole('button', { name: /Rex/ });
    expect(screen.queryByRole('button', { name: '+ Add dog' })).toBeNull();
  });

  it('dog: no Log link, Edit, Archive or report', async () => {
    await seed(tess);
    const { unmount } = await renderAt(tess, '/dog/d1');
    for (const name of ['Edit', 'Archive', 'Progress report (PDF)']) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Log' })).toBeInTheDocument();
    unmount();

    await renderAt(paul, '/dog/d1');
    await screen.findByRole('link', { name: /^MDMA/ });
    expect(screen.queryByRole('link', { name: 'Log' })).toBeNull();
    for (const name of [/^Edit/, /^Rename/, /^Archive/, /report/i]) expect(screen.queryByRole('button', { name })).toBeNull();
  });
});

describe('a handler: redirected routes', () => {
  it('/members goes to the teams', async () => {
    await seed(paul);
    await renderAt(paul, '/members');
    await homeHeading();
    expect(screen.queryByTestId('invite-code')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Members' })).toBeNull();
  });

  it('/archived goes to the teams, with no Restore or Delete forever', async () => {
    await seed(paul);
    await renderAt(paul, '/archived');
    await homeHeading();
    expect(screen.queryByRole('heading', { name: 'Archived' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Restore|Delete/ })).toBeNull();
  });

  it('/dog/:id/log goes to the dog screen', async () => {
    await seed(paul);
    await renderAt(paul, '/dog/d1/log');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rex' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Log' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Sessions' })).toBeNull();
  });

  it('/dog/:id/log is the log for a trainer', async () => {
    await seed(tess);
    await renderAt(tess, '/dog/d1/log');
    expect(await screen.findByRole('heading', { level: 1, name: 'Log' })).toBeInTheDocument();
  });

  it('a team that is archived, and a dog in it, are not there for a handler', async () => {
    await seed(paul);
    const { unmount } = await renderAt(paul, '/team/t9');
    await homeHeading();
    unmount();
    await renderAt(paul, '/dog/d9');
    await homeHeading();
  });
});

describe('a handler can choose a dog and add time', () => {
  it('goes teams -> dogs -> dog -> timer, and can start it and add a session by hand', async () => {
    await seed(paul);
    await renderAt(paul, '/');
    await userEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Rex/ }));
    await userEvent.click(await screen.findByRole('link', { name: /^MDMA/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Add a session I forgot to time' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Minutes'), '5');
    await userEvent.click(dialog.getByRole('button', { name: 'Save session' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // saved
    expect((await db.sessions.where('dog_id').equals('d1').toArray()).map((s) => s.kind).sort())
      .toEqual(['manual', 'manual', 'timed']);
  });
});
