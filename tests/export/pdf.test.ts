// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Correction, Dog, Session } from '../../src/domain/types';
import { dogReportPdf, pdfSafe, teamReportPdf } from '../../src/export/pdf';
import { CATEGORIES, ODOURS, dogRow, pick, team } from '../fixtures';

const rex: Dog = dogRow('d1', 'Rex');
/** The 17 narcotics and explosives: what the report listed before the catalogue moved into the database. */
const LISTED = ODOURS.filter((o) => o.category_id === 'narcotics' || o.category_id === 'explosives');
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
  sessions: SESSIONS, corrections: CORRECTIONS, categories: CATEGORIES, odours: LISTED, ...over,
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

  it('has one table per category that has odours to list, named as in the catalogue, in catalogue order', async () => {
    const odours = [...LISTED.filter((o) => o.id === 'mdma'), ...ODOURS.filter((o) => o.category_id === 'bed-bugs'),
      { id: 'notes', unit_id: 'u1', category_id: 'currency', name: 'Banknotes', created_at: '', archived_at: null }];
    const categories = [...CATEGORIES, { id: 'currency', unit_id: 'u1', name: 'Currency', sort: 5, created_at: '', archived_at: null }];
    const pdf = await text(await dogReportPdf(input({ odours, categories })));
    for (const heading of ['Narcotics', 'Bed bugs', 'Currency']) expect(pdf).toContain(`(${heading})`);
    for (const absent of ['Explosives', 'Cadaver']) expect(pdf).not.toContain(`(${absent})`);
    for (const name of ['MDMA', 'Live bed bugs', 'Viable eggs', 'Banknotes']) expect(pdf).toContain(`(${name})`);
    expect(pdf.indexOf('(Narcotics)')).toBeLessThan(pdf.indexOf('(Bed bugs)'));
    expect(pdf.indexOf('(Bed bugs)')).toBeLessThan(pdf.indexOf('(Currency)'));
  });

  it('carries on over a second page when there are too many odours for one', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `x${i}`, unit_id: 'u1', category_id: 'narcotics', name: `Odour ${i}`, created_at: '', archived_at: null,
    }));
    const pdf = await text(await dogReportPdf(input({ odours: many })));
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2); // 27 rows fit under the heading, the other 13 follow
    expect(pdf).toContain('(Odour 39)');
    expect(pdf).toContain('(Manual sessions: 2)'); // the footer still comes last
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

describe('dogReportPdf header (spec 13.6)', () => {
  it('shows the breed and the purpose under the dog name', async () => {
    const pdf = await text(await dogReportPdf(input({ dog: dogRow('d1', 'Rex', { breed: 'malinois', purpose: 'dual' }) })));
    expect(pdf).toContain('(Malinois \u00b7 Dual purpose)');
    const other = await text(await dogReportPdf(input({ dog: dogRow('d1', 'Rex', { breed: 'german-shepherd', purpose: 'single' }) })));
    expect(other).toContain('(German Shepherd \u00b7 Single purpose)');
  });

  it('names the team after the unit when it is given one', async () => {
    expect(await text(await dogReportPdf(input({ teamName: 'Alpha' })))).toContain('(Border K9 \u00b7 Alpha)');
    expect(await text(await dogReportPdf(input()))).toContain('(Border K9)');
  });
});

describe('teamReportPdf (spec 13.6)', () => {
  const alpha = team('t1', 'Alpha');
  const rexT = dogRow('d1', 'Rex', { breed: 'malinois', purpose: 'dual' });
  const bellaT = dogRow('d2', 'Bella', { breed: 'labrador', purpose: 'single' });
  const lunaT = dogRow('d3', 'Luna', { breed: 'german-shepherd', purpose: 'dual' });
  const oldMax = dogRow('d4', 'Old Max', { archived_at: '2026-10-02T00:00:00Z' });
  const fly = dogRow('d5', 'Fly', { team_id: 't2' });
  const SESS: Session[] = [
    manual('a', 'cocaine', '2026-10-01', 4500, 'd1'), // Rex: 75:00 on cocaine
    manual('b', 'mdma', '2026-10-02', 600, 'd2'), // Bella: 10:00 on MDMA
    manual('c', 'tnt', '2026-10-02', 777, 'd4'), // archived dog: left out
    manual('d', 'tnt', '2026-10-02', 888, 'd5'), // another team's dog: left out
  ];
  const teamInput = (over: Partial<Parameters<typeof teamReportPdf>[0]> = {}) => ({
    team: alpha, unitName: 'Border K9', generatedBy: 'Tess', generatedAt: new Date(2026, 9, 9, 14, 30),
    dogs: [rexT, bellaT, lunaT, oldMax, fly], sessions: SESS, corrections: [] as Correction[],
    categories: CATEGORIES, odours: ODOURS,
    // The team trains on cocaine and MDMA (narcotics) and TNT (explosives) only.
    teamOdours: [pick('t1', 'cocaine'), pick('t1', 'mdma'), pick('t1', 'tnt')], ...over,
  });
  const pages = (pdf: string) => pdf.match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
  const count = (pdf: string, needle: string) => pdf.split(needle).length - 1;

  it('returns an A4 portrait PDF', async () => {
    const blob = await teamReportPdf(teamInput());
    expect(blob.type).toBe('application/pdf');
    const pdf = await text(blob);
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
  });

  it('has one page per active dog of the team, and none for an archived dog or another team\'s dog', async () => {
    const pdf = await text(await teamReportPdf(teamInput()));
    expect(pages(pdf)).toBe(3);
    for (const name of ['Rex', 'Bella', 'Luna']) expect(pdf).toContain(`(${name})`);
    expect(pdf).not.toContain('(Old Max)');
    expect(pdf).not.toContain('(Fly)');
  });

  it('puts the dogs in name order, each with its own totals', async () => {
    const pdf = await text(await teamReportPdf(teamInput()));
    const at = (needle: string) => pdf.indexOf(needle);
    expect(at('(Bella)')).toBeLessThan(at('(10:00)'));
    expect(at('(10:00)')).toBeLessThan(at('(Luna)'));
    expect(at('(Luna)')).toBeLessThan(at('(Rex)'));
    expect(at('(Rex)')).toBeLessThan(at('(75:00)'));
    expect(count(pdf, '(75:00)')).toBe(1);
    expect(pdf).not.toContain('(12:57)'); // the archived dog's 777 s
    expect(pdf).not.toContain('(14:48)'); // the other team's dog's 888 s
  });

  it('shows each dog\'s breed and purpose, and the unit and team, in the page header', async () => {
    const pdf = await text(await teamReportPdf(teamInput()));
    expect(pdf).toContain('(Malinois \u00b7 Dual purpose)');
    expect(pdf).toContain('(Labrador \u00b7 Single purpose)');
    expect(pdf).toContain('(German Shepherd \u00b7 Dual purpose)');
    expect(count(pdf, '(Border K9 \u00b7 Alpha)')).toBe(3);
    expect(count(pdf, '(Generated 9 Oct 2026 by Tess)')).toBe(3);
  });

  it('lists the team\'s categories as sections, and only the odours the team trains on', async () => {
    const pdf = await text(await teamReportPdf(teamInput()));
    expect(count(pdf, '(Narcotics)')).toBe(3);
    expect(count(pdf, '(Explosives)')).toBe(3);
    for (const name of ['Cocaine', 'MDMA', 'TNT']) expect(count(pdf, `(${name})`), name).toBe(3);
    for (const absent of ['Heroin', 'Cannabis', 'C4/RDX', 'Cadaver', 'Bed bugs']) expect(pdf, absent).not.toContain(`(${absent})`);
  });

  it('also lists an odour the dog has time on that the team no longer trains, on that dog\'s page only', async () => {
    const withExtra = [...SESS, manual('e', 'human-remains', '2026-10-03', 300, 'd3')];
    const pdf = await text(await teamReportPdf(teamInput({ sessions: withExtra })));
    expect(count(pdf, '(Human remains)')).toBe(1);
    expect(count(pdf, '(Cadaver)')).toBe(1);
    expect(pages(pdf)).toBe(3);
  });

  it('leaves out an odour the team has ticked if it has been archived', async () => {
    const odours = ODOURS.map((o) => (o.id === 'tnt' ? { ...o, archived_at: '2026-10-05T00:00:00Z' } : o));
    const pdf = await text(await teamReportPdf(teamInput({ odours })));
    expect(pdf).not.toContain('(TNT)');
    expect(pdf).not.toContain('(Explosives)');
  });

  it('counts each dog\'s manual sessions and corrections on its own page', async () => {
    const corrections = [fix('c1', 'b', { new_duration_s: 540 })];
    const pdf = await text(await teamReportPdf(teamInput({ corrections })));
    expect(count(pdf, '(Manual sessions: 1)')).toBe(2); // Rex and Bella
    expect(count(pdf, '(Manual sessions: 0)')).toBe(1); // Luna
    expect(count(pdf, '(Corrections: 1)')).toBe(1);
    expect(count(pdf, '(Corrections: 0)')).toBe(2);
    expect(pdf).toContain('(9:00)'); // Bella's corrected MDMA
  });

  it('says so, on one page, when the team has no active dog', async () => {
    const pdf = await text(await teamReportPdf(teamInput({ dogs: [oldMax, fly] })));
    expect(pages(pdf)).toBe(1);
    expect(pdf).toContain('(Alpha)');
    expect(pdf).toContain('(No active dogs in this team.)');
  });

  it('copes with names the PDF font cannot draw', async () => {
    const pdf = await text(await teamReportPdf(teamInput({ team: team('t1', 'Łódź 日本'), dogs: [dogRow('d1', 'Łukasz 日本犬')] })));
    expect(pdf.startsWith('%PDF')).toBe(true);
  });
});

describe('pdfSafe', () => {
  it('keeps Latin-1 letters and replaces anything the standard PDF font cannot draw with "?"', () => {
    expect(pdfSafe('Zoë Müller')).toBe('Zoë Müller');
    expect(pdfSafe('Łukasz ✓')).toBe('?ukasz ?');
    expect(pdfSafe('Rex')).toBe('Rex');
  });
});
