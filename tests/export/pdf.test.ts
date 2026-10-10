// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Correction, Dog, Session } from '../../src/domain/types';
import { dogReportPdf, pdfSafe } from '../../src/export/pdf';

const rex: Dog = { id: 'd1', unit_id: 'u1', name: 'Rex', created_by: 'mT', created_at: '2026-10-01T00:00:00Z', archived_at: null };
const manual = (id: string, odour: string, date: string, seconds: number, dogId = 'd1'): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: 'mA', kind: 'manual', session_date: date,
  started_at: null, ended_at: null, duration_s: seconds, client_clock_offset_s: null, server_received_at: null,
});
const timed = (id: string, odour: string, date: string, seconds: number): Session => ({
  ...manual(id, odour, date, seconds), kind: 'timed', started_at: `${date}T09:00:00.000Z`, ended_at: `${date}T10:00:00.000Z`,
});
const fix = (id: string, sessionId: string, extra: Partial<Correction>): Correction => ({
  id, session_id: sessionId, unit_id: 'u1', trainer_id: 'mT', void: false, new_duration_s: null,
  reason: 'r', created_at: '2026-10-08T10:00:00Z', ...extra,
});

const SESSIONS: Session[] = [
  manual('a', 'cocaine', '2026-10-01', 3000),
  timed('b', 'cocaine', '2026-10-03', 1700), // 4700: imprinted on the 3rd
  manual('c', 'mdma', '2026-10-04', 2520), // 42:00, not imprinted
  timed('d', 'tnt', '2026-10-05', 600),
  manual('e', 'heroin', '2026-10-06', 300), // voided
  manual('f', 'cocaine', '2026-10-07', 100, 'd2'), // another dog: must not count
];
const CORRECTIONS: Correction[] = [fix('c1', 'e', { void: true, reason: 'Wrong dog' }), fix('c2', 'd', { new_duration_s: 540 })];

const input = (over: Partial<Parameters<typeof dogReportPdf>[0]> = {}) => ({
  dog: rex, unitName: 'Border K9', generatedBy: 'Tess', generatedAt: new Date(2026, 9, 9, 14, 30),
  sessions: SESSIONS, corrections: CORRECTIONS, ...over,
});
const text = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString('latin1');

describe('dogReportPdf', () => {
  it('returns a non-empty PDF blob', async () => {
    const blob = await dogReportPdf(input());
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(500);
    expect((await text(blob)).startsWith('%PDF')).toBe(true);
  });

  it('is one A4 portrait page', async () => {
    const pdf = await text(await dogReportPdf(input()));
    expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/); // 210 x 297 mm
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
  });

  it('shows the dog, the unit, and when and by whom it was made', async () => {
    const pdf = await text(await dogReportPdf(input()));
    expect(pdf).toContain('(Rex)');
    expect(pdf).toContain('(Border K9)');
    expect(pdf).toContain('(Generated 9 Oct 2026 by Tess)');
  });

  it('has a Narcotics and an Explosives table with one row per odour', async () => {
    const pdf = await text(await dogReportPdf(input()));
    expect(pdf).toContain('(Narcotics)');
    expect(pdf).toContain('(Explosives)');
    for (const name of ['Cocaine', 'Heroin', 'Methamphetamine', 'MDMA', 'Cannabis', 'Fentanyl',
      'TNT', 'C4/RDX', 'PETN', 'Semtex', 'Black powder', 'Smokeless powder', 'Ammonium nitrate', 'Det cord',
      'Dynamite', 'TATP', 'HMTD']) {
      expect(pdf, name).toContain(`(${name})`);
    }
    for (const head of ['Odour', 'Total', 'Progress', 'Imprinted', 'Sessions']) expect(pdf).toContain(`(${head})`);
  });

  it('shows totals as mm:ss after corrections, the imprint date, and the session count', async () => {
    const pdf = await text(await dogReportPdf(input()));
    expect(pdf).toContain('(78:20)'); // cocaine 3000 + 1700 s
    expect(pdf).toContain('(3 Oct 2026)'); // when its running total reached 75:00
    expect(pdf).toContain('(42:00)'); // MDMA
    expect(pdf).toContain('(9:00)'); // TNT corrected from 10:00 to 9:00
    expect(pdf).toContain('(0:00)'); // untrained odours and the voided heroin
    expect(pdf).not.toContain('(1:40)'); // the other dog's session
  });

  it('draws an outlined progress bar for each of the 17 odours, filled only where there is time', async () => {
    const tracks = (pdf: string) => (pdf.match(/ re\nB/g) ?? []).length; // outlined track
    const fills = (pdf: string) => (pdf.match(/ re\nS/g) ?? []).length; // olive fill, outlined again on top
    const empty = await text(await dogReportPdf(input({ sessions: [], corrections: [] })));
    expect(tracks(empty)).toBe(17);
    expect(fills(empty)).toBe(0);
    const busy = await text(await dogReportPdf(input()));
    expect(tracks(busy)).toBe(17);
    expect(fills(busy)).toBe(3); // cocaine, MDMA, TNT; the voided heroin has no time
  });

  it('ends with the number of manual sessions and of corrections', async () => {
    const pdf = await text(await dogReportPdf(input()));
    // manual and not voided for this dog: a, c = 2 (e is voided, f is another dog's); corrections for this dog: 2
    expect(pdf).toContain('(Manual sessions: 2)');
    expect(pdf).toContain('(Corrections: 2)');
  });

  it('copes with names that the PDF font cannot draw', async () => {
    const blob = await dogReportPdf(input({ dog: { ...rex, name: 'Łukasz 日本犬' }, generatedBy: 'Zoë ✓' }));
    expect((await text(blob)).startsWith('%PDF')).toBe(true);
  });
});

describe('pdfSafe', () => {
  it('keeps Latin-1 letters and replaces anything the standard PDF font cannot draw with "?"', () => {
    expect(pdfSafe('Zoë Müller')).toBe('Zoë Müller');
    expect(pdfSafe('Łukasz ✓')).toBe('?ukasz ?');
    expect(pdfSafe('Rex')).toBe('Rex');
  });
});
