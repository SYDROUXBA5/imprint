import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import type { Dog, Member, Session } from '../../src/domain/types';
import { dogRow, meRecord, pick, seedCatalogue } from '../fixtures';
import { FAKE_CLOCK } from '../fakeClock';

vi.mock('../../src/data/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data/repo')>();
  return { ...actual, startSession: vi.fn(actual.startSession) };
});
const { AlreadyRunningError, startSession } = await import('../../src/data/repo');
const { TimerScreen } = await import('../../src/ui/screens/TimerScreen');

const T0 = '2026-10-05T10:00:00.000Z';
const hana: Member = { id: 'mA', unit_id: 'u1', user_id: 'uA', name: 'Hana', role: 'handler', joined_at: '', removed_at: null };
const paul: Member = { id: 'mP', unit_id: 'u1', user_id: 'uP', name: 'Paul', role: 'handler', joined_at: '', removed_at: null };
const rex: Dog = dogRow('d1', 'Rex');
const manual = (id: string, odour: string, minutes: number): Session => ({
  id, unit_id: 'u1', dog_id: 'd1', odour_id: odour, handler_id: 'mA', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: minutes * 60, client_clock_offset_s: null, server_received_at: null,
});
const running = (id: string, odour: string, handler: Member, startedAt = T0): Session => ({
  ...manual(id, odour, 0), kind: 'timed', duration_s: null, started_at: startedAt, handler_id: handler.id,
});

async function seed(sessions: Session[] = [], me: Member = hana) {
  await db.meta.put({ key: ME_KEY, value: meRecord(me) });
  await db.members.bulkPut([hana, paul]);
  await seedCatalogue(db);
  await db.dogs.put(rex);
  await db.sessions.bulkPut(sessions);
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
const renderTimer = (odour = 'mdma') => render(
  <MemoryRouter initialEntries={[`/dog/d1/timer/${odour}`]}>
    <Routes>
      <Route path="/dog/:dogId/timer/:odourId" element={<TimerScreen />} />
      <Route path="/dog/:dogId" element={<Where />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const user = () => userEvent.setup({ delay: null });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const clock = () => screen.getByTestId('session-clock');

beforeEach(async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  vi.setSystemTime(new Date(T0));
  await db.delete();
  await db.open();
});
afterEach(() => vi.useRealTimers());

describe('TimerScreen', () => {
  it('shows the dog and odour, a zero clock and the stored total', async () => {
    await seed([manual('s1', 'mdma', 42)]);
    renderTimer();
    expect(await screen.findByRole('heading', { name: 'Rex' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'MDMA' })).toBeInTheDocument();
    expect(clock()).toHaveTextContent('0:00');
    expect(screen.getByText('42 / 75 min total')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '56');
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('hides the decorative dots around the dog name from screen readers', async () => {
    await seed();
    renderTimer();
    const h1 = await screen.findByRole('heading', { name: 'Rex' });
    const dots = within(h1).getAllByText('•');
    expect(dots).toHaveLength(2);
    dots.forEach((d) => expect(d).toHaveAttribute('aria-hidden', 'true'));
  });

  it('Start creates a running session and the clock counts up to 12:04', async () => {
    await seed();
    renderTimer();
    await user().click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    const [s] = await db.sessions.where('handler_id').equals('mA').toArray();
    expect(s).toMatchObject({ dog_id: 'd1', odour_id: 'mdma', kind: 'timed', ended_at: null });
    await advance(724_000);
    expect(clock()).toHaveTextContent('12:04');
  });

  it('the caption and ring include live time', async () => {
    await seed([manual('s1', 'mdma', 42)]);
    renderTimer();
    await user().click(await screen.findByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });
    await advance(724_000);
    expect(screen.getByText('54 / 75 min total')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '72');
  });

  it('Stop saves the session and shows "+12 min · now 54/75"', async () => {
    await seed([manual('s1', 'mdma', 42)]);
    renderTimer();
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Start' }));
    const stop = await screen.findByRole('button', { name: 'Stop' });
    await advance(724_000);
    await u.click(stop);
    await advance(500); // let the live query settle after the 724 s jump of the fake clock
    expect(await screen.findByText('+12 min · now 54/75')).toBeInTheDocument();
    const saved = (await db.sessions.where('handler_id').equals('mA').toArray()).find((s) => s.kind === 'timed')!;
    expect(saved.duration_s).toBe(724);
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(clock()).toHaveTextContent('0:00');
  });

  it('blocks Start when another handler is running a timer on this dog, and offers no Stop', async () => {
    await seed([running('r', 'mdma', paul)]);
    renderTimer();
    expect(await screen.findByText('Paul is already running MDMA on Rex.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('blocks Start for any odour while another odour is running on the dog', async () => {
    await seed([running('r', 'mdma', paul)]);
    renderTimer('cocaine');
    expect(await screen.findByText('Paul is already running MDMA on Rex.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('shows Stop to the handler who has the timer running', async () => {
    await seed([running('r', 'mdma', hana)]);
    renderTimer();
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('points the handler to their own running timer on another odour', async () => {
    await seed([running('r', 'mdma', hana)]);
    renderTimer('cocaine');
    expect(await screen.findByText('You are already running MDMA on Rex.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open the MDMA timer' })).toHaveAttribute('href', '/dog/d1/timer/mdma');
  });

  it('keeps running past 75 minutes: 2:30:00 after 9000 s, no auto-stop', async () => {
    await seed([running('r', 'mdma', hana, new Date(Date.now() - 9000_000).toISOString())]);
    renderTimer();
    await screen.findByRole('button', { name: 'Stop' });
    expect(clock()).toHaveTextContent('2:30:00');
    await advance(2000);
    expect(clock()).toHaveTextContent('2:30:02');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect((await db.sessions.get('r'))!.ended_at).toBeNull();
  });

  it('says so when Start loses a race with another handler', async () => {
    await seed();
    vi.mocked(startSession).mockRejectedValueOnce(new AlreadyRunningError(running('r', 'heroin', paul)));
    renderTimer();
    await user().click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Paul is already running Heroin on Rex.');
  });

  it('does not tick while nothing runs on this odour', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    await seed();
    renderTimer();
    await screen.findByRole('button', { name: 'Start' });
    expect(spy.mock.calls.filter(([, ms]) => ms === 1000)).toHaveLength(0);
  });

  describe('crossing 75 minutes', () => {
    const celebrating = () => screen.getByRole('main').getAttribute('data-celebrating');

    it('flags a celebration when live time takes the odour over 75:00', async () => {
      await seed([manual('s1', 'mdma', 74), running('r', 'mdma', hana)]);
      renderTimer();
      await screen.findByRole('button', { name: 'Stop' });
      expect(celebrating()).toBe('false');
      await advance(61_000);
      expect(celebrating()).toBe('true');
    });

    it('plays the overlay over a timer that keeps running, and a tap closes it for good', async () => {
      await seed([manual('s1', 'mdma', 74), running('r', 'mdma', hana)]);
      renderTimer();
      await screen.findByRole('button', { name: 'Stop' });
      expect(screen.queryByText('Rex: MDMA imprinted')).toBeNull();
      await advance(61_000);
      expect(await screen.findByText('Rex: MDMA imprinted')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Imprinted' })).toBeInTheDocument();
      await advance(2000);
      expect(clock()).toHaveTextContent('1:03'); // still counting underneath
      await user().click(screen.getByText('Rex: MDMA imprinted'));
      expect(screen.queryByText('Rex: MDMA imprinted')).toBeNull();
      expect(celebrating()).toBe('false');
      await advance(5000);
      expect(screen.queryByText('Rex: MDMA imprinted')).toBeNull(); // plays once
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    it('plays after a manual entry takes the odour over 75:00', async () => {
      await seed([manual('s1', 'mdma', 74)]);
      renderTimer();
      const u = user();
      await u.click(await screen.findByRole('button', { name: 'Add a session I forgot to time' }));
      await u.type(await screen.findByLabelText('Minutes'), '2');
      await u.click(screen.getByRole('button', { name: 'Save session' }));
      expect(await screen.findByText('Rex: MDMA imprinted')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a session I forgot to time' })).toBeNull());
      expect(await screen.findByText('76 / 75 min total')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(await db.outbox.count()).toBe(1); // queued for sync
      await u.click(screen.getByText('Rex: MDMA imprinted'));
      expect(screen.queryByText('Rex: MDMA imprinted')).toBeNull();
    });

    it('does not fire when an already-imprinted odour is opened', async () => {
      await seed([manual('s1', 'mdma', 80)]);
      renderTimer();
      await screen.findByRole('button', { name: 'Start' });
      await advance(2000);
      expect(screen.getByText('80 / 75 min total')).toBeInTheDocument();
      expect(celebrating()).toBe('false');
    });

    it('does not fire while the local data is still loading', async () => {
      await seed([manual('s1', 'mdma', 80), running('r', 'mdma', hana, new Date(Date.now() - 5000).toISOString())]);
      renderTimer();
      await screen.findByRole('button', { name: 'Stop' });
      expect(celebrating()).toBe('false');
    });
  });

  describe('navigation', () => {
    it('back goes to the dog screen on the same group when opened directly', async () => {
      await seed();
      renderTimer('tnt');
      await user().click(await screen.findByRole('button', { name: 'Back' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1?cat=explosives');
    });

    it('goes to the dog screen when the odour is unknown', async () => {
      await seed();
      renderTimer('nope');
      expect(await screen.findByTestId('where')).toHaveTextContent('/dog/d1');
    });

    it('goes home when the dog is unknown', async () => {
      await db.meta.put({ key: ME_KEY, value: meRecord(hana) });
      renderTimer();
      expect(await screen.findByTestId('where')).toHaveTextContent('/');
    });

    it('opens the manual entry sheet from "Add a session I forgot to time"', async () => {
      await seed();
      renderTimer();
      await user().click(await screen.findByRole('button', { name: 'Add a session I forgot to time' }));
      expect(screen.getByRole('dialog', { name: 'Add a session I forgot to time' })).toBeInTheDocument();
    });
  });

  it('marks an odour the team does not train on any more, and still lets a timer be run on it', async () => {
    await seed();
    await db.team_odours.put(pick('t1', 'mdma', false));
    renderTimer();
    expect(await screen.findByRole('heading', { name: 'MDMA' })).toBeInTheDocument();
    expect(screen.getByText('(not in current list)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('shows no such mark for an odour in the team\'s list', async () => {
    await seed();
    renderTimer();
    await screen.findByRole('heading', { name: 'MDMA' });
    expect(screen.queryByText('(not in current list)')).toBeNull();
  });
});
