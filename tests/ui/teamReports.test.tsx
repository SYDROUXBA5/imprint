import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dogRow, seedCatalogue } from '../fixtures';
import type { Correction, Member, Session } from '../../src/domain/types';

vi.mock('../../src/data/account');
vi.mock('../../src/export/share', () => ({ shareOrDownload: vi.fn() }));
vi.mock('../../src/export/pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/export/pdf')>()),
  dogReportPdf: vi.fn(),
  teamReportPdf: vi.fn(),
}));

const { db, ME_KEY } = await import('../../src/data/db');
const { shareOrDownload } = await import('../../src/export/share');
const { dogReportPdf, teamReportPdf } = await import('../../src/export/pdf');
const { localDate } = await import('../../src/domain/format');
const { TeamDogsScreen } = await import('../../src/ui/screens/TeamDogsScreen');
const { TeamSettingsSheet } = await import('../../src/ui/screens/TeamSettingsSheet');
const { DogScreen } = await import('../../src/ui/screens/DogScreen');

const tess: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const paul: Member = { ...tess, id: 'mP', user_id: 'uP', name: 'Paul', role: 'handler' };
const session = (id: string, dogId: string, odour: string, seconds: number): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mP', kind: 'manual', session_date: '2026-10-03',
  started_at: null, ended_at: null, duration_s: seconds, client_clock_offset_s: null, server_received_at: null,
});
const correction: Correction = {
  id: 'c1', session_id: 's1', unit_id: 'u1', trainer_id: 'mT', void: false, new_duration_s: 300,
  reason: 'Stopped late', created_at: '2026-10-04T10:00:00Z',
};

/** Alpha: Rex (Malinois, dual), Bella (Labrador, single), archived Old Max. Bravo: Fly. */
async function seed(me: Member) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.units.put({ id: 'u1', name: 'Border K9', invite_code: 'K7M2QX', created_at: '2026-10-01T00:00:00Z' });
  await db.members.bulkPut([tess, paul]);
  await seedCatalogue(db, ['t1', 't2']);
  await db.teams.update('t2', { name: 'Bravo' });
  await db.dogs.bulkPut([
    dogRow('d1', 'Rex', { breed: 'malinois', purpose: 'dual' }), dogRow('d2', 'Bella'),
    dogRow('d3', 'Old Max', { archived_at: '2026-10-02T00:00:00Z' }), dogRow('d4', 'Fly', { team_id: 't2' }),
  ]);
  await db.sessions.bulkPut([
    session('s1', 'd1', 'mdma', 600), session('s2', 'd2', 'cocaine', 900),
    session('s3', 'd3', 'tnt', 120), session('s4', 'd4', 'tnt', 60),
  ]);
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
const today = () => localDate(new Date());

const renderTeam = () => render(
  <MemoryRouter initialEntries={['/team/t1']}>
    <Routes>
      <Route path="/team/:teamId" element={<TeamDogsScreen />} />
      <Route path="/dog/:dogId" element={<DogScreen />} />
      <Route path="*" element={<p>elsewhere</p>} />
    </Routes>
  </MemoryRouter>,
);
const openSettings = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  return within(await screen.findByRole('dialog'));
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(shareOrDownload).mockResolvedValue('shared');
  vi.mocked(dogReportPdf).mockResolvedValue(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
  vi.mocked(teamReportPdf).mockResolvedValue(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
  await db.delete();
  await db.open();
});

describe('Team settings: reports (spec 13.6)', () => {
  it('gives a trainer a team PDF and a team CSV button', async () => {
    await seed(tess);
    renderTeam();
    const dialog = await openSettings();
    expect(dialog.getByRole('button', { name: 'Team report (PDF)' })).toBeEnabled();
    expect(dialog.getByRole('button', { name: 'Team sessions (CSV)' })).toBeEnabled();
  });

  it('builds the team PDF from the team\'s own dogs and sessions and shares it as imprint-<team>-<date>.pdf', async () => {
    await seed(tess);
    renderTeam();
    await userEvent.click((await openSettings()).getByRole('button', { name: 'Team report (PDF)' }));
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
    expect(teamReportPdf).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(teamReportPdf).mock.calls[0][0];
    expect(arg.team.name).toBe('Alpha');
    expect(arg.unitName).toBe('Border K9');
    expect(arg.generatedBy).toBe('Tess');
    expect(arg.dogs.map((d) => d.id).sort()).toEqual(['d1', 'd2', 'd3']); // not Bravo's Fly; the report page skips archived ones
    expect(arg.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(arg.corrections.map((c) => c.id)).toEqual(['c1']);
    expect(arg.teamOdours.every((t) => t.team_id === 't1')).toBe(true);
    expect(arg.odours.length).toBeGreaterThan(0);
    const [blob, filename] = vi.mocked(shareOrDownload).mock.calls[0];
    expect(blob.type).toBe('application/pdf');
    expect(filename).toBe(`imprint-alpha-${today()}.pdf`);
    expect(dogReportPdf).not.toHaveBeenCalled();
  });

  it('shares the team CSV as imprint-<team>-<date>.csv, limited to the team and with team, breed, purpose and category', async () => {
    await seed(tess);
    renderTeam();
    await userEvent.click((await openSettings()).getByRole('button', { name: 'Team sessions (CSV)' }));
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
    const [blob, filename] = vi.mocked(shareOrDownload).mock.calls[0];
    expect(filename).toBe(`imprint-alpha-${today()}.csv`);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const csv = await readBlob(blob);
    expect(csv).toContain('dog,dog archived,team,breed,purpose,category,odour,handler,kind,date');
    expect(csv).toContain('Rex,no,Alpha,Malinois,Dual purpose,Narcotics,MDMA,Paul,manual,2026-10-03,,,10:00,600,5:00,300,no,Stopped late,');
    expect(csv).toContain('Bella,no,Alpha,Labrador,Single purpose,Narcotics,Cocaine,Paul,manual,2026-10-03,,,15:00,900,15:00,900,no,,');
    expect(csv).toContain('Old Max,yes,Alpha,'); // archived dogs of the team stay in
    expect(csv).not.toContain('Fly'); // another team's dog
    expect(csv).not.toContain('Bravo');
  });

  it('warns once about unsynced items, and only when there are some', async () => {
    await seed(tess);
    renderTeam();
    const dialog = await openSettings();
    await dialog.findByRole('button', { name: 'Team report (PDF)' });
    expect(dialog.queryByText(/not synced yet/)).toBeNull();
    await queueUnsynced(3);
    expect(await dialog.findAllByText(/3 items not synced yet/)).toHaveLength(1);
    expect(dialog.getByText(/3 items not synced yet/)).toHaveTextContent('They are in this export');
  });

  it('says where a plain download went, and shows an error when the file cannot be made', async () => {
    await seed(tess);
    renderTeam();
    const dialog = await openSettings();
    vi.mocked(shareOrDownload).mockResolvedValueOnce('downloaded');
    await userEvent.click(dialog.getByRole('button', { name: 'Team sessions (CSV)' }));
    expect(await dialog.findByText('Saved to your downloads.')).toBeInTheDocument();
    vi.mocked(teamReportPdf).mockRejectedValueOnce(new Error('chunk failed to load'));
    await userEvent.click(dialog.getByRole('button', { name: 'Team report (PDF)' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not make the file. Try again.');
  });

  it('is never shown to a handler: no Settings button on the team screen', async () => {
    await seed(paul);
    renderTeam();
    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Team report (PDF)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Team sessions (CSV)' })).toBeNull();
  });

  it('is never shown to a handler even if the settings sheet itself were opened for them', async () => {
    await seed(paul);
    const [catalogue, team] = await Promise.all([
      Promise.all([db.odour_categories.toArray(), db.odours.toArray(), db.team_odours.toArray()])
        .then(([categories, odours, teamOdours]) => ({ categories, odours, teamOdours })),
      db.teams.get('t1'),
    ]);
    render(<TeamSettingsSheet open onClose={() => {}} team={team!} catalogue={catalogue} timerRunning={false} />);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Team report (PDF)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Team sessions (CSV)' })).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
  });
});

describe('Dog screen: PDF report names the team (spec 13.6)', () => {
  it('passes the dog\'s team name, so the header can show it after the unit', async () => {
    await seed(tess);
    render(<MemoryRouter initialEntries={['/dog/d1']}><Routes><Route path="/dog/:dogId" element={<DogScreen />} /></Routes></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Progress report (PDF)' }));
    await waitFor(() => expect(dogReportPdf).toHaveBeenCalledTimes(1));
    expect(vi.mocked(dogReportPdf).mock.calls[0][0].teamName).toBe('Alpha');
  });
});
