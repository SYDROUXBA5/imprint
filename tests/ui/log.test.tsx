import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import type { Correction, Dog, Member, Session } from '../../src/domain/types';
import { dogRow, seedCatalogue } from '../fixtures';
import { LogScreen } from '../../src/ui/screens/LogScreen';

const tess: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const hana: Member = { id: 'mA', unit_id: 'u1', user_id: 'uA', name: 'Hana', role: 'handler', joined_at: '', removed_at: null };
const paul: Member = { id: 'mP', unit_id: 'u1', user_id: 'uP', name: 'Paul', role: 'handler', joined_at: '', removed_at: null };
const rex: Dog = dogRow('d1', 'Rex');
const bella: Dog = { ...rex, id: 'd2', name: 'Bella' };

const base = {
  unit_id: 'u1', dog_id: 'd1', client_clock_offset_s: null, server_received_at: null,
};
const timed = (id: string, odour: string, handler: Member, start: string, end: string, extra: Partial<Session> = {}): Session => ({
  ...base, id, odour_id: odour, handler_id: handler.id, kind: 'timed', session_date: start.slice(0, 10),
  started_at: start, ended_at: end, duration_s: Math.round((Date.parse(end) - Date.parse(start)) / 1000), ...extra,
});
const manual = (id: string, odour: string, handler: Member, date: string, seconds: number, extra: Partial<Session> = {}): Session => ({
  ...base, id, odour_id: odour, handler_id: handler.id, kind: 'manual', session_date: date,
  started_at: null, ended_at: null, duration_s: seconds, ...extra,
});
const correction = (id: string, sessionId: string, extra: Partial<Correction>): Correction => ({
  id, session_id: sessionId, unit_id: 'u1', trainer_id: 'mT', void: false, new_duration_s: null,
  reason: 'r', created_at: '2026-10-06T12:00:00.000Z', ...extra,
});

const SESSIONS: Session[] = [
  timed('s1', 'mdma', hana, '2026-10-01T09:00:00.000Z', '2026-10-01T09:20:00.000Z'), // 20:00, oldest
  manual('s2', 'cocaine', paul, '2026-10-03', 600),
  timed('s3', 'mdma', paul, '2026-10-05T10:00:00.000Z', '2026-10-05T10:10:00.000Z'), // overlaps s4
  timed('s4', 'mdma', hana, '2026-10-05T10:05:00.000Z', '2026-10-05T10:15:00.000Z'),
  timed('s5', 'heroin', hana, '2026-10-06T08:00:00.000Z', '2026-10-06T08:12:04.000Z'), // 12:04, corrected to 10:00
  manual('s6', 'cannabis', paul, '2026-10-07', 300), // voided
  timed('s7', 'fentanyl', hana, '2026-10-08T08:00:00.000Z', '2026-10-08T08:03:00.000Z', { client_clock_offset_s: 7200 }), // newest
  { ...manual('x1', 'tnt', paul, '2026-10-08', 900), dog_id: 'd2' }, // another dog
];
const CORRECTIONS: Correction[] = [
  correction('c1', 's5', { new_duration_s: 600, reason: 'Stopped late', created_at: '2026-10-03T12:00:00.000Z' }),
  correction('c2', 's6', { void: true, reason: 'Wrong dog', created_at: '2026-10-08T12:00:00.000Z' }),
];

async function seed(me: Member, sessions = SESSIONS, corrections = CORRECTIONS) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.bulkPut([tess, hana, paul]);
  await seedCatalogue(db);
  await db.dogs.bulkPut([rex, bella]);
  await db.sessions.bulkPut(sessions);
  await db.corrections.bulkPut(corrections);
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}
const renderLog = (dogId = 'd1') => render(
  <MemoryRouter initialEntries={[`/dog/${dogId}/log`]}>
    <Routes>
      <Route path="/dog/:dogId/log" element={<LogScreen />} />
      <Route path="/dog/:dogId" element={<Where />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const rows = async () => within(await screen.findByRole('list', { name: 'Sessions' })).getAllByRole('listitem');
const rowFor = async (text: string) => {
  const r = (await rows()).find((li) => li.textContent?.includes(text));
  if (!r) throw new Error(`No row containing ${text}`);
  return r;
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('LogScreen', () => {
  it('lists totals per odour at the top, only for odours with time logged', async () => {
    await seed(hana);
    renderLog();
    const totals = within(await screen.findByRole('region', { name: 'Totals' }));
    expect(totals.getByText('MDMA').nextSibling).toHaveTextContent('40:00'); // 20 + 10 + 10 min
    expect(totals.getByText('Cocaine').nextSibling).toHaveTextContent('10:00');
    expect(totals.getByText('Heroin').nextSibling).toHaveTextContent('10:00'); // after the correction
    expect(totals.getByText('Fentanyl').nextSibling).toHaveTextContent('3:00');
    expect(totals.queryByText('Cannabis')).toBeNull(); // voided: no time
    expect(totals.queryByText('TNT')).toBeNull(); // only logged on another dog
    expect(totals.queryByText('Methamphetamine')).toBeNull();
  });

  it("shows only this dog's sessions, newest first, with date, odour, handler and duration", async () => {
    await seed(hana);
    renderLog();
    const list = await rows();
    expect(list).toHaveLength(7);
    const order = list.map((li) => /(\d+ Oct 2026)/.exec(li.textContent ?? '')?.[1]);
    expect(order).toEqual(['8 Oct 2026', '7 Oct 2026', '6 Oct 2026', '5 Oct 2026', '5 Oct 2026', '3 Oct 2026', '1 Oct 2026']);
    const newest = within(list[0]);
    expect(newest.getByText('Fentanyl')).toBeInTheDocument();
    expect(newest.getByText('Hana')).toBeInTheDocument();
    expect(newest.getByText('3:00')).toBeInTheDocument();
    const oldest = within(list[6]);
    expect(oldest.getByText('MDMA')).toBeInTheDocument();
    expect(oldest.getByText('20:00')).toBeInTheDocument();
    expect(screen.queryByText('TNT')).toBeNull();
  });

  it('labels each session: Timed, Manual, Corrected by, Voided, Overlap, Clock check', async () => {
    await seed(hana);
    renderLog();
    const oldest = within(await rowFor('1 Oct 2026'));
    expect(oldest.getByText('Timed')).toBeInTheDocument();
    expect(oldest.queryByText('Overlap')).toBeNull();

    const manualRow = within(await rowFor('3 Oct 2026'));
    expect(manualRow.getByText('Manual')).toBeInTheDocument();
    expect(manualRow.getByText('Paul')).toBeInTheDocument();

    const corrected = within(await rowFor('Heroin'));
    expect(corrected.getByText('Timed')).toBeInTheDocument();
    expect(corrected.getByText('Corrected by Tess, 3 Oct')).toBeInTheDocument();

    const voided = within(await rowFor('Cannabis'));
    expect(voided.getByText('Voided')).toBeInTheDocument();
    expect(voided.getByText('Manual')).toBeInTheDocument(); // several labels can apply

    const overlapRows = (await rows()).filter((li) => within(li).queryByText('Overlap'));
    expect(overlapRows).toHaveLength(2);
    overlapRows.forEach((li) => expect(li).toHaveTextContent('5 Oct 2026'));

    const clock = within(await rowFor('Fentanyl'));
    expect(clock.getByText('Clock check')).toBeInTheDocument();
  });

  it('shows the original duration struck through, the new value and the reason on a corrected row', async () => {
    await seed(hana);
    renderLog();
    const row = within(await rowFor('Heroin'));
    const struck = row.getByText('12:04');
    expect(struck.closest('s')).not.toBeNull();
    expect(row.getByText('10:00').closest('s')).toBeNull();
    expect(row.getByText(/Stopped late/)).toBeInTheDocument();
  });

  it('shows a voided row with the original struck through, 0:00 and the reason', async () => {
    await seed(hana);
    renderLog();
    const row = within(await rowFor('Cannabis'));
    expect(row.getByText('5:00').closest('s')).not.toBeNull();
    expect(row.getByText('0:00')).toBeInTheDocument();
    expect(row.getByText(/Wrong dog/)).toBeInTheDocument();
  });

  it('the latest of two corrections counts, and the row still shows the original', async () => {
    await seed(hana, SESSIONS, [
      ...CORRECTIONS,
      correction('c3', 's5', { new_duration_s: 420, reason: 'Second look', created_at: '2026-10-04T12:00:00.000Z' }),
    ]);
    renderLog();
    const row = within(await rowFor('Heroin'));
    expect(row.getByText('12:04').closest('s')).not.toBeNull();
    expect(row.getByText('7:00')).toBeInTheDocument();
    expect(row.getByText('Corrected by Tess, 4 Oct')).toBeInTheDocument();
  });

  it('the odour filter narrows the list', async () => {
    await seed(hana);
    renderLog();
    await userEvent.selectOptions(await screen.findByLabelText('Odour'), 'MDMA');
    const list = await rows();
    expect(list).toHaveLength(3);
    list.forEach((li) => expect(within(li).getByText('MDMA')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Odour'), 'All odours');
    expect(await rows()).toHaveLength(7);
  });

  it('shows a running session with a live clock and the label Running', async () => {
    const started = new Date(Date.now() - 125_000).toISOString();
    await seed(hana, [{
      ...timed('r1', 'tnt', paul, started, started), ended_at: null, duration_s: null,
    }], []);
    renderLog();
    const row = within(await rowFor('TNT'));
    expect(row.getByText('Running')).toBeInTheDocument();
    expect(row.queryByText('Timed')).toBeNull();
    expect(row.getByTestId('live-clock')).toHaveTextContent(/^2:0[5-9]$/);
  });

  it('says so when there is nothing logged yet', async () => {
    await seed(hana, [], []);
    renderLog();
    expect(await screen.findByText('Nothing logged yet')).toBeInTheDocument();
  });

  it('goes home when the dog does not exist', async () => {
    await seed(hana);
    renderLog('nope');
    expect(await screen.findByTestId('where')).toHaveTextContent('/');
  });

  it('back returns to the dog screen', async () => {
    await seed(hana);
    renderLog();
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/dog/d1');
  });

  describe('roles', () => {
    it('a handler sees the whole log but no Correct or Void buttons', async () => {
      await seed(hana);
      renderLog();
      expect(await rows()).toHaveLength(7);
      expect(screen.queryByRole('button', { name: /^Correct/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Void/ })).toBeNull();
    });

    it('a trainer sees Correct and Void on every row', async () => {
      await seed(tess);
      renderLog();
      const list = await rows();
      expect(screen.getAllByRole('button', { name: /^Correct/ })).toHaveLength(list.length);
      expect(screen.getAllByRole('button', { name: /^Void/ })).toHaveLength(list.length);
      for (const li of list) {
        expect(within(li).getByRole('button', { name: /^Correct/ })).toBeInTheDocument();
        expect(within(li).getByRole('button', { name: /^Void/ })).toBeInTheDocument();
      }
    });
  });

  describe('correction sheet', () => {
    const openCorrect = async (text: string) => {
      await userEvent.click(within(await rowFor(text)).getByRole('button', { name: /^Correct/ }));
      return screen.findByRole('dialog', { name: 'Correct session' });
    };

    it('takes minutes and seconds for the new duration, starting from the current one', async () => {
      await seed(tess);
      renderLog();
      const dialog = within(await openCorrect('1 Oct 2026'));
      expect(dialog.getByLabelText('Minutes')).toHaveValue('20');
      expect(dialog.getByLabelText('Seconds')).toHaveValue('0');
    });

    it('requires a reason', async () => {
      await seed(tess);
      renderLog();
      const dialog = within(await openCorrect('1 Oct 2026'));
      await userEvent.click(dialog.getByRole('button', { name: 'Save correction' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('A reason is required');
      expect(await db.corrections.count()).toBe(CORRECTIONS.length);
    });

    it('saves a correction of 5 min 30 s with its reason, closes, and the row shows it', async () => {
      await seed(tess);
      renderLog();
      const dialog = within(await openCorrect('1 Oct 2026'));
      const mins = dialog.getByLabelText('Minutes');
      const secs = dialog.getByLabelText('Seconds');
      await userEvent.clear(mins); await userEvent.type(mins, '5');
      await userEvent.clear(secs); await userEvent.type(secs, '30');
      await userEvent.type(dialog.getByLabelText('Reason'), 'Forgot to stop');
      await userEvent.click(dialog.getByRole('button', { name: 'Save correction' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const saved = (await db.corrections.toArray()).find((c) => c.session_id === 's1')!;
      expect(saved).toMatchObject({ void: false, new_duration_s: 330, reason: 'Forgot to stop', trainer_id: 'mT' });
      expect(await db.outbox.count()).toBe(1);
      const row = within(await rowFor('1 Oct 2026'));
      expect(await row.findByText('5:30')).toBeInTheDocument();
      expect(row.getByText('20:00').closest('s')).not.toBeNull();
      expect(row.getByText(/Forgot to stop/)).toBeInTheDocument();
    });

    it.each([['minutes', '1.5', '0'], ['seconds', '5', '75'], ['seconds', '5', '-1'], ['minutes', 'ten', '0']])(
      'rejects bad %s (%s / %s)', async (_what, m, s) => {
        await seed(tess);
        renderLog();
        const dialog = within(await openCorrect('1 Oct 2026'));
        const mins = dialog.getByLabelText('Minutes');
        const secs = dialog.getByLabelText('Seconds');
        await userEvent.clear(mins); await userEvent.type(mins, m);
        await userEvent.clear(secs); await userEvent.type(secs, s);
        await userEvent.type(dialog.getByLabelText('Reason'), 'x');
        await userEvent.click(dialog.getByRole('button', { name: 'Save correction' }));
        expect(await dialog.findByRole('alert')).toHaveTextContent(/whole minutes|seconds/i);
        expect(await db.corrections.count()).toBe(CORRECTIONS.length);
      },
    );

    it('voiding one of two overlapping sessions clears the Overlap flag on the other', async () => {
      await seed(tess);
      renderLog();
      const paulsFifth = (await rows()).find((li) => li.textContent?.includes('5 Oct 2026') && li.textContent.includes('Paul'))!;
      await userEvent.click(within(paulsFifth).getByRole('button', { name: /^Void/ }));
      const dialog = within(await screen.findByRole('dialog', { name: 'Void session' }));
      await userEvent.type(dialog.getByLabelText('Reason'), 'Double entry');
      await userEvent.click(dialog.getByRole('button', { name: 'Void session' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(async () =>
        expect((await rows()).filter((li) => within(li).queryByText('Overlap'))).toHaveLength(0));
    });

    it('Void asks for a reason in the same sheet and stores a void', async () => {
      await seed(tess);
      renderLog();
      await userEvent.click(within(await rowFor('1 Oct 2026')).getByRole('button', { name: /^Void/ }));
      const dialog = within(await screen.findByRole('dialog', { name: 'Void session' }));
      expect(dialog.queryByLabelText('Minutes')).toBeNull();
      await userEvent.click(dialog.getByRole('button', { name: 'Void session' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('A reason is required');
      await userEvent.type(dialog.getByLabelText('Reason'), 'Wrong dog');
      await userEvent.click(dialog.getByRole('button', { name: 'Void session' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const saved = (await db.corrections.toArray()).find((c) => c.session_id === 's1')!;
      expect(saved).toMatchObject({ void: true, new_duration_s: null, reason: 'Wrong dog' });
      const row = within(await rowFor('1 Oct 2026'));
      expect(await row.findByText('Voided')).toBeInTheDocument();
    });

    it('a trainer can correct again, and a correction can bring a voided session back', async () => {
      await seed(tess);
      renderLog();
      const dialog = within(await openCorrect('Cannabis'));
      expect(dialog.getByLabelText('Minutes')).toHaveValue('0'); // current value of a voided session is 0:00
      const mins = dialog.getByLabelText('Minutes');
      await userEvent.clear(mins); await userEvent.type(mins, '5');
      await userEvent.type(dialog.getByLabelText('Reason'), 'It was right after all');
      await userEvent.click(dialog.getByRole('button', { name: 'Save correction' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const row = within(await rowFor('Cannabis'));
      await waitFor(() => expect(row.queryByText('Voided')).toBeNull());
      expect(row.getByText('Corrected by Tess', { exact: false })).toBeInTheDocument();
    });
  });
});
