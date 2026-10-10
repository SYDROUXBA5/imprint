import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import { localDate } from '../../src/domain/format';
import type { Dog, Member, Session } from '../../src/domain/types';
import { dogRow, seedCatalogue } from '../fixtures';
import { ManualEntrySheet } from '../../src/ui/screens/ManualEntrySheet';

const hana: Member = { id: 'mA', unit_id: 'u1', user_id: 'uA', name: 'Hana', role: 'handler', joined_at: '', removed_at: null };
const rex: Dog = dogRow('d1', 'Rex');
const manual = (id: string, odour: string, minutes: number, dog = 'd1'): Session => ({
  id, unit_id: 'u1', dog_id: dog, odour_id: odour, handler_id: 'mA', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: minutes * 60, client_clock_offset_s: null, server_received_at: null,
});

const today = () => localDate(new Date());
const tomorrow = () => localDate(new Date(Date.now() + 86_400_000));

async function seed(sessions: Session[] = [], me: Member = hana) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.put(hana);
  await seedCatalogue(db);
  await db.dogs.put(rex);
  await db.sessions.bulkPut(sessions);
}

function renderSheet(extra: { onClose?: () => void; onCrossed?: () => void } = {}) {
  const props = { onClose: vi.fn(), onCrossed: vi.fn(), ...extra };
  render(<ManualEntrySheet open dogId="d1" odourId="mdma" {...props} />);
  return props;
}
const minutes = () => screen.findByLabelText('Minutes');
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save session' }));
const manualRows = () => db.sessions.toArray();

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('ManualEntrySheet', () => {
  it('renders nothing while closed', async () => {
    await seed();
    render(<ManualEntrySheet open={false} dogId="d1" odourId="mdma" onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has a date that defaults to today and cannot go past it, and a whole-minutes field', async () => {
    await seed();
    renderSheet();
    const date = await screen.findByLabelText('Date');
    expect(date).toHaveValue(today());
    expect(date).toHaveAttribute('max', today());
    expect(await minutes()).toHaveValue('');
  });

  it('Save with 10 stores a manual session of 600 s for this dog and odour, by this handler, and closes', async () => {
    await seed();
    const { onClose, onCrossed } = renderSheet();
    await userEvent.type(await minutes(), '10');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const rows = await manualRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dog_id: 'd1', odour_id: 'mdma', handler_id: 'mA', kind: 'manual', duration_s: 600,
      session_date: today(), started_at: null, ended_at: null,
    });
    expect(onCrossed).not.toHaveBeenCalled();
  });

  it('queues the session for sync', async () => {
    await seed();
    renderSheet();
    await userEvent.type(await minutes(), '10');
    await save();
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    expect((await db.outbox.toArray())[0]).toMatchObject({ table: 'sessions', op: 'insert', status: 'pending' });
  });

  it('keeps a date picked earlier', async () => {
    await seed();
    renderSheet();
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-09-30' } });
    await userEvent.type(await minutes(), '5');
    await save();
    await waitFor(async () => expect(await manualRows()).toHaveLength(1));
    expect((await manualRows())[0].session_date).toBe('2026-09-30');
  });

  it.each([['blank', ''], ['zero', '0'], ['a decimal', '2.5'], ['negative', '-5'], ['words', 'ten']])(
    'rejects %s minutes with "Enter whole minutes above 0" and stores nothing',
    async (_name, text) => {
      await seed();
      const { onClose } = renderSheet();
      const field = await minutes();
      if (text) await userEvent.type(field, text);
      await save();
      expect(await screen.findByRole('alert')).toHaveTextContent('Enter whole minutes above 0');
      expect(onClose).not.toHaveBeenCalled();
      expect(await db.sessions.count()).toBe(0);
    },
  );

  it('refuses a future date', async () => {
    await seed();
    const { onClose } = renderSheet();
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: tomorrow() } });
    await userEvent.type(await minutes(), '10');
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('The date cannot be in the future');
    expect(onClose).not.toHaveBeenCalled();
    expect(await db.sessions.count()).toBe(0);
  });

  it('refuses an empty date', async () => {
    await seed();
    renderSheet();
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '' } });
    await userEvent.type(await minutes(), '10');
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a date');
    expect(await db.sessions.count()).toBe(0);
  });

  describe('crossing 75 minutes', () => {
    it('calls onCrossed when the new total reaches 75:00', async () => {
      await seed([manual('old', 'mdma', 74)]);
      const { onCrossed, onClose } = renderSheet();
      await userEvent.type(await minutes(), '1');
      await save();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onCrossed).toHaveBeenCalledTimes(1);
    });

    it('does not call it when the total stays below 75:00', async () => {
      await seed([manual('old', 'mdma', 70)]);
      const { onCrossed, onClose } = renderSheet();
      await userEvent.type(await minutes(), '4');
      await save();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onCrossed).not.toHaveBeenCalled();
    });

    it('does not call it again for an odour that was already imprinted', async () => {
      await seed([manual('old', 'mdma', 80)]);
      const { onCrossed, onClose } = renderSheet();
      await userEvent.type(await minutes(), '5');
      await save();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onCrossed).not.toHaveBeenCalled();
    });

    it('counts only this odour on this dog', async () => {
      await seed([manual('old', 'mdma', 70), manual('other-odour', 'cocaine', 70), manual('other-dog', 'mdma', 70, 'd2')]);
      const { onCrossed, onClose } = renderSheet();
      await userEvent.type(await minutes(), '10'); // 70 + 10 on this odour alone; the other rows would hide the crossing
      await save();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onCrossed).toHaveBeenCalledTimes(1);
    });

    it('respects a trainer correction that lowered an earlier session', async () => {
      await seed([manual('old', 'mdma', 80)]);
      await db.corrections.put({
        id: 'c1', session_id: 'old', unit_id: 'u1', trainer_id: 'mT', void: false, new_duration_s: 60 * 60,
        reason: 'typo', created_at: '2026-10-04T00:00:00Z',
      });
      const { onCrossed, onClose } = renderSheet();
      await userEvent.type(await minutes(), '20'); // 60 + 20 = 80: crosses
      await save();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onCrossed).toHaveBeenCalledTimes(1);
    });
  });
});
