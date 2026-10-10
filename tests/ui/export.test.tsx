import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dogRow, seedCatalogue } from '../fixtures';
import type { Correction, Dog, Member, Session } from '../../src/domain/types';

vi.mock('../../src/data/account');
vi.mock('../../src/export/share', () => ({ shareOrDownload: vi.fn() }));
vi.mock('../../src/export/pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/export/pdf')>()),
  dogReportPdf: vi.fn(),
}));

const { db, ME_KEY } = await import('../../src/data/db');
const { shareOrDownload } = await import('../../src/export/share');
const { dogReportPdf } = await import('../../src/export/pdf');
const { localDate } = await import('../../src/domain/format');
const { TeamScreen } = await import('../../src/ui/screens/TeamScreen');
const { DogScreen } = await import('../../src/ui/screens/DogScreen');

const tess: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const paul: Member = { ...tess, id: 'mP', user_id: 'uP', name: 'Paul', role: 'handler' };
const dog = (id: string, name: string, archived: string | null = null): Dog => dogRow(id, name, { archived_at: archived });
const session = (id: string, dogId: string, odour: string, seconds: number): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mP', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: seconds, client_clock_offset_s: null, server_received_at: null,
});
const correction: Correction = {
  id: 'c1', session_id: 's1', unit_id: 'u1', trainer_id: 'mT', void: false, new_duration_s: 300,
  reason: 'Stopped late', created_at: '2026-10-04T10:00:00Z',
};

async function seed(me: Member) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.units.put({ id: 'u1', name: 'Border K9', invite_code: 'K7M2QX', created_at: '2026-10-01T00:00:00Z' });
  await db.members.bulkPut([tess, paul]);
  await seedCatalogue(db);
  await db.dogs.bulkPut([dog('d1', 'Rex'), dog('d2', 'Bella', '2026-10-06T00:00:00Z')]);
  await db.sessions.bulkPut([session('s1', 'd1', 'mdma', 600), session('s2', 'd2', 'tnt', 900)]);
  await db.corrections.put(correction);
}
const queueUnsynced = (n: number) =>
  db.outbox.bulkAdd(Array.from({ length: n }, (_, i) => ({
    table: 'sessions' as const, op: 'insert' as const, row: { id: `new${i}` }, created_at: '2026-10-09T10:00:00Z', status: 'pending' as const,
  })));
const readBlob = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsText(b);
});
const firstBytes = (b: Blob, n: number) => new Promise<number[]>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve([...new Uint8Array(r.result as ArrayBuffer)].slice(0, n));
  r.onerror = () => reject(r.error);
  r.readAsArrayBuffer(b);
});
const today = () => localDate(new Date());

const renderTeam = () => render(<MemoryRouter initialEntries={['/team']}><Routes><Route path="/team" element={<TeamScreen />} /></Routes></MemoryRouter>);
const renderDog = () => render(
  <MemoryRouter initialEntries={['/dog/d1']}><Routes><Route path="/dog/:dogId" element={<DogScreen />} /></Routes></MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(shareOrDownload).mockResolvedValue('shared');
  vi.mocked(dogReportPdf).mockResolvedValue(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
  await db.delete();
  await db.open();
});

describe('Team screen: CSV export', () => {
  it('exports every session, archived dogs included, through the share sheet', async () => {
    await seed(tess);
    renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: 'Export all sessions (CSV)' }));
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
    const [blob, filename] = vi.mocked(shareOrDownload).mock.calls[0];
    expect(filename).toBe(`imprint-border-k9-${today()}.csv`);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(await firstBytes(blob, 3)).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 byte order mark, so Excel shows accents
    const csv = await readBlob(blob); // reading as text drops the mark
    expect(csv).toContain('dog,dog archived,group,odour,handler,kind,date');
    expect(csv).toContain('Rex,no,Narcotics,MDMA,Paul,manual,2026-10-03,,,10:00,600,5:00,300,no,Stopped late,');
    expect(csv).toContain('Bella,yes,Explosives,TNT,Paul,manual,2026-10-03,,,15:00,900,15:00,900,no,,');
  });

  it('says where a plain download went, and says nothing when the share sheet was closed', async () => {
    await seed(tess);
    renderTeam();
    vi.mocked(shareOrDownload).mockResolvedValueOnce('downloaded');
    await userEvent.click(await screen.findByRole('button', { name: 'Export all sessions (CSV)' }));
    expect(await screen.findByText('Saved to your downloads.')).toBeInTheDocument();
    vi.mocked(shareOrDownload).mockResolvedValueOnce('cancelled');
    await userEvent.click(screen.getByRole('button', { name: 'Export all sessions (CSV)' }));
    await waitFor(() => expect(screen.queryByText('Saved to your downloads.')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error when the file cannot be made', async () => {
    await seed(tess);
    vi.mocked(shareOrDownload).mockRejectedValueOnce(new Error('disk full'));
    renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: 'Export all sessions (CSV)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not make the file. Try again.');
  });

  it('disables the button while the file is being made', async () => {
    await seed(tess);
    let finish!: (v: 'shared') => void;
    vi.mocked(shareOrDownload).mockReturnValueOnce(new Promise((r) => { finish = r; }));
    renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: 'Export all sessions (CSV)' }));
    expect(await screen.findByRole('button', { name: 'Preparing…' })).toBeDisabled();
    finish('shared');
    expect(await screen.findByRole('button', { name: 'Export all sessions (CSV)' })).toBeEnabled();
  });

  it('warns about unsynced items, and only when there are some', async () => {
    await seed(tess);
    renderTeam();
    await screen.findByRole('button', { name: 'Export all sessions (CSV)' });
    expect(screen.queryByText(/not synced yet/)).toBeNull();
    await queueUnsynced(3);
    expect(await screen.findByText(/3 items not synced yet/)).toBeInTheDocument();
  });

  it('uses the singular for one unsynced item', async () => {
    await seed(tess);
    await queueUnsynced(1);
    renderTeam();
    expect(await screen.findByText(/1 item not synced yet\. It is in this export/)).toBeInTheDocument();
  });
});

describe('Dog screen: PDF report', () => {
  it('gives a trainer "Progress report (PDF)", which builds the report for this dog and shares it', async () => {
    await seed(tess);
    renderDog();
    await userEvent.click(await screen.findByRole('button', { name: 'Progress report (PDF)' }));
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
    expect(dogReportPdf).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(dogReportPdf).mock.calls[0][0];
    expect(arg.dog.name).toBe('Rex');
    expect(arg.unitName).toBe('Border K9');
    expect(arg.generatedBy).toBe('Tess');
    expect(arg.sessions.map((s) => s.id)).toEqual(['s1']); // not Bella's
    expect(arg.corrections.map((c) => c.id)).toEqual(['c1']);
    const [blob, filename] = vi.mocked(shareOrDownload).mock.calls[0];
    expect(blob.type).toBe('application/pdf');
    expect(filename).toBe(`imprint-rex-${today()}.pdf`);
  });

  it('is hidden from a handler, who can still see the dog', async () => {
    await seed(paul);
    renderDog();
    expect(await screen.findByRole('button', { name: 'Narcotics' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Progress report (PDF)' })).toBeNull();
    expect(dogReportPdf).not.toHaveBeenCalled();
  });

  it('shows the unsynced-items warning here too', async () => {
    await seed(tess);
    await queueUnsynced(2);
    renderDog();
    const warning = await screen.findByText(/2 items not synced yet/);
    expect(warning).toHaveTextContent('They are in this export');
    expect(within(warning.closest('[role="status"]') as HTMLElement).getByText(/2 items/)).toBeInTheDocument();
  });

  it('shows an error when the report cannot be made', async () => {
    await seed(tess);
    vi.mocked(dogReportPdf).mockRejectedValueOnce(new Error('chunk failed to load'));
    renderDog();
    await userEvent.click(await screen.findByRole('button', { name: 'Progress report (PDF)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not make the file. Try again.');
    expect(shareOrDownload).not.toHaveBeenCalled();
  });
});
