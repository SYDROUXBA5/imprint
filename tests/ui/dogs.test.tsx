import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import type { Dog, Member, Session } from '../../src/domain/types';
import { DogsScreen } from '../../src/ui/screens/DogsScreen';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { id: 'mH', unit_id: 'u1', user_id: 'uH', name: 'Paul', role: 'handler', joined_at: '', removed_at: null };
const dog = (id: string, name: string, archived: string | null = null): Dog =>
  ({ id, unit_id: 'u1', name, created_by: 'mT', created_at: '2026-10-01T00:00:00Z', archived_at: archived });
const manual = (id: string, dogId: string, odour: string, date: string, minutes: number): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mH', kind: 'manual', session_date: date,
  started_at: null, ended_at: null, duration_s: minutes * 60, client_clock_offset_s: null, server_received_at: null,
});

async function seed(me: Member) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.members.bulkPut([trainer, handler]);
  await db.dogs.bulkPut([dog('d1', 'Rex'), dog('d2', 'Bella'), dog('d3', 'Old Max', '2026-10-02T00:00:00Z')]);
  await db.sessions.bulkPut([
    manual('s1', 'd1', 'cocaine', '2026-10-01', 75),
    manual('s2', 'd1', 'mdma', '2026-10-03', 42),
    manual('s3', 'd2', 'tnt', '2026-10-02', 18),
  ]);
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}
const renderDogs = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<DogsScreen />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('DogsScreen', () => {
  it('shows each active dog with a progress line, most recently trained first', async () => {
    await seed(trainer);
    renderDogs();
    const rex = await screen.findByRole('button', { name: /Rex/ });
    expect(within(rex).getByText('Rex')).toBeInTheDocument();
    expect(within(rex).getByText('MDMA 42/75 · Cocaine ✓')).toBeInTheDocument();
    const bella = screen.getByRole('button', { name: /Bella/ });
    expect(within(bella).getByText('TNT 18/75')).toBeInTheDocument();
  });

  it('lists dogs by name and leaves archived dogs out', async () => {
    await seed(trainer);
    renderDogs();
    await screen.findByRole('button', { name: /Rex/ });
    const names = screen.getAllByRole('listitem').map((li) => within(li).getByRole('button').textContent);
    expect(names[0]).toMatch(/Bella/);
    expect(names[1]).toMatch(/Rex/);
    expect(screen.queryByText('Old Max')).toBeNull();
  });

  it('opens the dog screen on tap', async () => {
    await seed(trainer);
    renderDogs();
    await userEvent.click(await screen.findByRole('button', { name: /Rex/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dog/d1');
  });

  it('pins a running timer at the top with the handler name', async () => {
    await seed(trainer);
    await db.sessions.put({
      ...manual('run', 'd1', 'mdma', '2026-10-05', 0), kind: 'timed', handler_id: 'mH', duration_s: null,
      started_at: new Date(Date.now() - 724_000).toISOString(),
    });
    renderDogs();
    expect(await screen.findByText(/^Running · Rex · MDMA · 12:0[4-9] · Paul$/)).toBeInTheDocument();
  });

  it('offers "+ Add dog" and "Team" to a trainer only', async () => {
    await seed(trainer);
    const { unmount } = renderDogs();
    expect(await screen.findByRole('button', { name: '+ Add dog' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
    unmount();
    await db.meta.put({ key: ME_KEY, value: handler });
    renderDogs();
    await screen.findByRole('button', { name: /Rex/ });
    expect(screen.queryByRole('button', { name: '+ Add dog' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull();
  });

  it('adds a dog by name', async () => {
    await seed(trainer);
    renderDogs();
    await userEvent.click(await screen.findByRole('button', { name: '+ Add dog' }));
    const save = screen.getByRole('button', { name: 'Add dog' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Dog name'), '  Ziggy ');
    await userEvent.click(save);
    expect(await screen.findByRole('button', { name: /Ziggy/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await db.outbox.toArray()).map((i) => `${i.table}:${i.op}`)).toEqual(['dogs:insert']);
  });

  it('shows the sync badge with the number of unsynced records', async () => {
    await seed(trainer);
    await db.outbox.add({ table: 'dogs', op: 'insert', row: { id: 'd1' }, created_at: new Date().toISOString(), status: 'pending' });
    renderDogs();
    expect(await screen.findByText('1 record not synced yet')).toBeInTheDocument();
    await db.outbox.bulkAdd([
      { table: 'sessions', op: 'insert', row: { id: 's1' }, created_at: new Date().toISOString(), status: 'pending' },
      { table: 'sessions', op: 'insert', row: { id: 's2' }, created_at: new Date().toISOString(), status: 'pending' },
    ]);
    expect(await screen.findByText('3 records not synced yet')).toBeInTheDocument();
  });

  it('has an empty state that points a trainer to adding a dog', async () => {
    await db.meta.put({ key: ME_KEY, value: trainer });
    renderDogs();
    expect(await screen.findByText('No dogs yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first dog')).toBeInTheDocument();
  });

  it('has an empty state for a handler without the add prompt', async () => {
    await db.meta.put({ key: ME_KEY, value: handler });
    renderDogs();
    expect(await screen.findByText('No dogs yet')).toBeInTheDocument();
    expect(screen.queryByText('Add your first dog')).toBeNull();
  });

  it('shows a one-off sync notice once, and lets it be dismissed', async () => {
    await seed(trainer);
    await db.meta.put({ key: 'notices', value: ['A session for a deleted dog was discarded.'] });
    const { unmount } = renderDogs();
    expect(await screen.findByText('A session for a deleted dog was discarded.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('A session for a deleted dog was discarded.')).toBeNull();
    unmount();
    renderDogs();
    await screen.findByRole('button', { name: /Rex/ });
    expect(screen.queryByText('A session for a deleted dog was discarded.')).toBeNull();
  });
});
