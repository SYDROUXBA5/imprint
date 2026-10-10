import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import { ODOURS } from '../../src/domain/odours';
import type { Dog, Member, Session } from '../../src/domain/types';
import { DogScreen } from '../../src/ui/screens/DogScreen';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { id: 'mH', unit_id: 'u1', user_id: 'uH', name: 'Paul', role: 'handler', joined_at: '', removed_at: null };
const rex: Dog = { id: 'd1', unit_id: 'u1', name: 'Rex', created_by: 'mT', created_at: '2026-10-01T00:00:00Z', archived_at: null };
const manual = (id: string, odour: string, seconds: number): Session => ({
  id, unit_id: 'u1', dog_id: 'd1', odour_id: odour, handler_id: 'mH', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: seconds, client_clock_offset_s: null, server_received_at: null,
});
const running = (id: string, odour: string, startedAt: string): Session => ({
  ...manual(id, odour, 0), kind: 'timed', duration_s: null, started_at: startedAt,
});

async function seed(me: Member = trainer, sessions: Session[] = []) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.bulkPut([trainer, handler]);
  await db.dogs.put(rex);
  await db.sessions.bulkPut([manual('s1', 'cocaine', 4500), manual('s2', 'mdma', 2520), ...sessions]);
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
function FakeTimer() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>fake timer back</button>;
}
const renderDog = (entry = '/dog/d1') => render(
  <MemoryRouter initialEntries={['/', entry]} initialIndex={1}>
    <Routes>
      <Route path="/" element={<Where />} />
      <Route path="/dog/:dogId" element={<><DogScreen /><Where /></>} />
      <Route path="/dog/:dogId/timer/:odourId" element={<><FakeTimer /><Where /></>} />
      <Route path="/dog/:dogId/log" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const rowNames = () => screen.getAllByRole('listitem').map((li) => li.querySelector('[data-odour-name]')?.textContent);

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => vi.useRealTimers());

describe('DogScreen', () => {
  it('opens on Narcotics and lists the 6 narcotics in spec order', async () => {
    await seed();
    renderDog();
    expect(await screen.findByRole('button', { name: 'Narcotics' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Explosives' })).toHaveAttribute('aria-pressed', 'false');
    expect(rowNames()).toEqual(ODOURS.filter((o) => o.group === 'narcotics').map((o) => o.name));
    expect(rowNames()).toHaveLength(6);
  });

  it('switches to the 11 explosives and keeps the group in the URL', async () => {
    await seed();
    renderDog();
    await userEvent.click(await screen.findByRole('button', { name: 'Explosives' }));
    expect(rowNames()).toEqual(ODOURS.filter((o) => o.group === 'explosives').map((o) => o.name));
    expect(rowNames()).toHaveLength(11);
    expect(screen.getByRole('button', { name: 'Explosives' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1?group=explosives');
  });

  it('opens on the group named in the URL', async () => {
    await seed();
    renderDog('/dog/d1?group=explosives');
    expect(await screen.findByRole('button', { name: 'Explosives' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('TNT')).toBeInTheDocument();
    expect(screen.queryByText('Cocaine')).toBeNull();
  });

  it('comes back from the timer on the same group', async () => {
    await seed();
    renderDog();
    await userEvent.click(await screen.findByRole('button', { name: 'Explosives' }));
    await userEvent.click(screen.getByRole('link', { name: /^TNT/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1/timer/tnt');
    await userEvent.click(screen.getByRole('button', { name: 'fake timer back' }));
    expect(await screen.findByRole('button', { name: 'Explosives' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('with no group in the URL, opens on the running odour\'s group', async () => {
    await seed(trainer, [running('r', 'tnt', new Date().toISOString())]);
    renderDog();
    expect(await screen.findByRole('button', { name: 'Explosives' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/dog\/d1$/); // chosen, not written to the URL
  });

  it('lets the URL win over the running odour, and ignores a junk group', async () => {
    await seed(trainer, [running('r', 'tnt', new Date().toISOString())]);
    const { unmount } = renderDog('/dog/d1?group=narcotics');
    expect(await screen.findByRole('button', { name: 'Narcotics' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    renderDog('/dog/d1?group=junk');
    expect(await screen.findByRole('button', { name: 'Explosives' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the IMPRINTED stamp (no fraction) at 75 min and "42/75" with a 56% bar below it', async () => {
    await seed();
    renderDog();
    const cocaine = (await screen.findByText('Cocaine')).closest('li')!;
    expect(within(cocaine).getByRole('img', { name: 'Imprinted' })).toBeInTheDocument();
    expect(within(cocaine).queryByText(/\/75/)).toBeNull();
    const mdma = screen.getByText('MDMA').closest('li')!;
    expect(within(mdma).getByText('42/75')).toBeInTheDocument();
    expect(within(mdma).queryByRole('img', { name: 'Imprinted' })).toBeNull();
    expect(within(mdma).getByRole('progressbar', { name: 'MDMA' })).toHaveAttribute('aria-valuenow', '56');
  });

  it('opens an odour\'s timer and the dog\'s log', async () => {
    await seed();
    renderDog();
    await userEvent.click(await screen.findByRole('link', { name: /^MDMA/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1/timer/mdma');
  });

  it('has a Log link in the header', async () => {
    await seed(handler);
    renderDog();
    await userEvent.click(await screen.findByRole('link', { name: 'Log' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1/log');
  });

  it('goes back to the dogs list', async () => {
    await seed();
    renderDog();
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('sends you home when the dog is not here (or is archived)', async () => {
    await seed();
    await db.dogs.update('d1', { archived_at: '2026-10-04T00:00:00Z' });
    renderDog();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
  });

  describe('trainer-only controls', () => {
    it('shows Rename and Archive to a trainer, not to a handler', async () => {
      await seed(trainer);
      const { unmount } = renderDog();
      expect(await screen.findByRole('button', { name: 'Rename' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
      unmount();
      await db.meta.put({ key: ME_KEY, value: handler });
      renderDog();
      await screen.findByText('Cocaine');
      expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    });

    it('renames the dog', async () => {
      await seed();
      renderDog();
      await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
      const field = screen.getByLabelText('Dog name');
      expect(field).toHaveValue('Rex');
      await userEvent.clear(field);
      expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
      await userEvent.type(field, 'Rexy');
      await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByRole('heading', { name: 'Rexy' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('asks before archiving, and Cancel keeps the dog', async () => {
      await seed();
      renderDog();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(
        'Archive Rex? It disappears from the list; you can restore it from Archived.',
      )).toBeInTheDocument();
      expect((await db.dogs.get('d1'))!.archived_at).toBeNull(); // one tap did not archive
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect((await db.dogs.get('d1'))!.archived_at).toBeNull();
    });

    it('archives on confirm and returns to the dogs list', async () => {
      await seed();
      renderDog();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive Rex' }));
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
      expect((await db.dogs.get('d1'))!.archived_at).not.toBeNull();
      expect((await db.outbox.toArray()).map((i) => `${i.table}:${i.op}`)).toEqual(['dogs:update']);
    });

    it('will not archive while a timer runs', async () => {
      await seed(trainer, [running('r', 'mdma', new Date().toISOString())]);
      renderDog();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Stop the running timer before archiving');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect((await db.dogs.get('d1'))!.archived_at).toBeNull();
    });
  });

  describe('live clock', () => {
    const spyIntervals = () => vi.spyOn(globalThis, 'setInterval');
    const tickers = (spy: ReturnType<typeof spyIntervals>) => spy.mock.calls.filter(([, ms]) => ms === 1000);

    it('does not tick while this dog has no running session', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const spy = spyIntervals();
      await seed();
      renderDog();
      await screen.findByText('Cocaine');
      expect(tickers(spy)).toHaveLength(0);
    });

    it('ticks while this dog has a running session, and the totals move', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
      const spy = spyIntervals();
      await seed(trainer, [running('r', 'heroin', '2026-10-05T10:00:00Z'), manual('h', 'heroin', 41 * 60)]);
      renderDog();
      const heroin = (await screen.findByText('Heroin')).closest('li')!;
      expect(within(heroin).getByText('41/75')).toBeInTheDocument();
      expect(tickers(spy).length).toBeGreaterThan(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(within(heroin).getByText('42/75')).toBeInTheDocument();
    });

    it('does not tick for a timer running on another dog', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const spy = spyIntervals();
      await seed(trainer, [{ ...running('r', 'mdma', new Date().toISOString()), dog_id: 'd2' }]);
      renderDog();
      await screen.findByText('Cocaine');
      expect(tickers(spy)).toHaveLength(0);
    });
  });

  it('marks the running odour with a dot that screen readers skip', async () => {
    await seed(trainer, [running('r', 'heroin', new Date().toISOString())]);
    renderDog();
    const heroin = (await screen.findByText('Heroin')).closest('li')!;
    const dot = within(heroin).getByTestId('running-dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(within(heroin).getByText('Running')).toBeInTheDocument();
    expect(within(screen.getByText('Cocaine').closest('li')!).queryByTestId('running-dot')).toBeNull();
  });
});
