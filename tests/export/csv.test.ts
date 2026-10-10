import { describe, expect, it } from 'vitest';
import type { Correction, Dog, Member, Session } from '../../src/domain/types';
import { CSV_HEADER, sessionsCsv } from '../../src/export/csv';

const member = (id: string, name: string, role: Member['role'] = 'handler'): Member => ({
  id, unit_id: 'u1', user_id: `u-${id}`, name, role, joined_at: '', removed_at: null,
});
const tess = member('mT', 'Tess', 'trainer');
const hana = member('mA', 'Hana');
const paul = member('mP', 'Paul');
const dog = (id: string, name: string, archived: string | null = null): Dog => ({
  id, unit_id: 'u1', name, created_by: 'mT', created_at: '2026-10-01T00:00:00Z', archived_at: archived,
});
const rex = dog('d1', 'Rex');
const bella = dog('d2', 'Bella', '2026-10-06T00:00:00Z');

const manual = (id: string, odour: string, handler: Member, date: string, seconds: number, dogId = 'd1'): Session => ({
  id, unit_id: 'u1', dog_id: dogId, odour_id: odour, handler_id: handler.id, kind: 'manual', session_date: date,
  started_at: null, ended_at: null, duration_s: seconds, client_clock_offset_s: null, server_received_at: null,
});
/** Times are built from local components, so the expected text does not depend on the machine's time zone. */
const local = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo - 1, d, h, mi, s).toISOString();
const timed = (id: string, odour: string, handler: Member, start: string, end: string | null, dogId = 'd1'): Session => ({
  ...manual(id, odour, handler, start.slice(0, 10), 0, dogId), kind: 'timed', started_at: start, ended_at: end,
  duration_s: end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : null,
});
const fix = (id: string, sessionId: string, create: string, extra: Partial<Correction>): Correction => ({
  id, session_id: sessionId, unit_id: 'u1', trainer_id: 'mT', void: false, new_duration_s: null,
  reason: 'r', created_at: create, ...extra,
});

/** A small RFC 4180 reader, to check the file the way a spreadsheet would read it. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const NOW = Date.parse('2026-10-09T12:00:00Z');
const build = (sessions: Session[], corrections: Correction[] = [], dogs: Dog[] = [rex, bella], members: Member[] = [tess, hana, paul]) =>
  sessionsCsv({ dogs, members, sessions, corrections, nowMs: NOW });
const body = (csv: string) => parseCsv(csv.slice(1)).slice(1);
const col = (name: (typeof CSV_HEADER)[number]) => CSV_HEADER.indexOf(name);

describe('sessionsCsv', () => {
  it('starts with a UTF-8 byte order mark, then the header row, with CRLF line ends', () => {
    const csv = build([manual('a', 'mdma', hana, '2026-10-03', 600)]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')[0]).toBe(CSV_HEADER.join(','));
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(CSV_HEADER).toEqual([
      'dog', 'dog archived', 'group', 'odour', 'handler', 'kind', 'date', 'start', 'end',
      'recorded duration (mm:ss)', 'recorded duration (s)', 'current duration (mm:ss)', 'current duration (s)',
      'voided', 'correction reasons', 'flags',
    ]);
  });

  it('gives a header-only file when there are no sessions', () => {
    expect(parseCsv(build([]).slice(1))).toEqual([[...CSV_HEADER]]);
  });

  it('writes one row per session, archived dogs included', () => {
    const rows = body(build([
      manual('a', 'mdma', hana, '2026-10-03', 600),
      manual('b', 'tnt', paul, '2026-10-04', 90, 'd2'),
    ]));
    expect(rows).toHaveLength(2);
    const bellaRow = rows.find((r) => r[col('dog')] === 'Bella')!;
    expect(bellaRow[col('dog archived')]).toBe('yes');
    expect(bellaRow[col('group')]).toBe('Explosives');
    expect(bellaRow[col('odour')]).toBe('TNT');
    const rexRow = rows.find((r) => r[col('dog')] === 'Rex')!;
    expect(rexRow[col('dog archived')]).toBe('no');
    expect(rexRow[col('group')]).toBe('Narcotics');
  });

  it('fills a timed session: handler, kind, date, local start and end, recorded and current durations', () => {
    const [row] = body(build([
      timed('t', 'mdma', hana, local(2026, 10, 5, 10, 0, 0), local(2026, 10, 5, 10, 12, 4)),
    ]));
    expect(row[col('handler')]).toBe('Hana');
    expect(row[col('kind')]).toBe('timed');
    expect(row[col('date')]).toBe('2026-10-05');
    expect(row[col('start')]).toBe('2026-10-05 10:00:00');
    expect(row[col('end')]).toBe('2026-10-05 10:12:04');
    expect(row[col('recorded duration (mm:ss)')]).toBe('12:04');
    expect(row[col('recorded duration (s)')]).toBe('724');
    expect(row[col('current duration (mm:ss)')]).toBe('12:04');
    expect(row[col('current duration (s)')]).toBe('724');
    expect(row[col('voided')]).toBe('no');
    expect(row[col('correction reasons')]).toBe('');
    expect(row[col('flags')]).toBe('');
  });

  it('leaves start and end blank for a manual session, and shows a 75-minute total as 75:00', () => {
    const [row] = body(build([manual('m', 'mdma', paul, '2026-10-03', 4500)]));
    expect(row[col('kind')]).toBe('manual');
    expect(row[col('start')]).toBe('');
    expect(row[col('end')]).toBe('');
    expect(row[col('recorded duration (mm:ss)')]).toBe('75:00');
    expect(row[col('recorded duration (s)')]).toBe('4500');
  });

  it('leaves end and recorded duration blank while a timer is still running', () => {
    const [row] = body(build([timed('r', 'mdma', hana, local(2026, 10, 9, 11, 0, 0), null)]));
    expect(row[col('end')]).toBe('');
    expect(row[col('recorded duration (s)')]).toBe('');
    expect(row[col('current duration (s)')]).toBe('0');
  });

  it('shows the recorded and the corrected duration side by side, with the reason', () => {
    const [row] = body(build(
      [manual('a', 'mdma', hana, '2026-10-03', 724)],
      [fix('c1', 'a', '2026-10-04T10:00:00Z', { new_duration_s: 600, reason: 'Stopped late' })],
    ));
    expect(row[col('recorded duration (s)')]).toBe('724');
    expect(row[col('current duration (s)')]).toBe('600');
    expect(row[col('current duration (mm:ss)')]).toBe('10:00');
    expect(row[col('voided')]).toBe('no');
    expect(row[col('correction reasons')]).toBe('Stopped late');
  });

  it('keeps voided sessions, marked voided = yes, with a current duration of 0', () => {
    const rows = body(build(
      [manual('a', 'mdma', hana, '2026-10-03', 600), manual('b', 'mdma', hana, '2026-10-04', 300)],
      [fix('c1', 'b', '2026-10-05T10:00:00Z', { void: true, reason: 'Wrong dog' })],
    ));
    expect(rows).toHaveLength(2);
    const voided = rows.find((r) => r[col('date')] === '2026-10-04')!;
    expect(voided[col('voided')]).toBe('yes');
    expect(voided[col('current duration (s)')]).toBe('0');
    expect(voided[col('recorded duration (s)')]).toBe('300');
    expect(voided[col('correction reasons')]).toBe('Wrong dog');
  });

  it('joins several reasons oldest first with " | ", and the latest correction decides the numbers', () => {
    const [row] = body(build(
      [manual('a', 'mdma', hana, '2026-10-03', 724)],
      [
        fix('c2', 'a', '2026-10-06T10:00:00Z', { void: true, reason: 'Duplicate' }),
        fix('c1', 'a', '2026-10-04T10:00:00Z', { new_duration_s: 600, reason: 'Stopped late' }),
      ],
    ));
    expect(row[col('correction reasons')]).toBe('Stopped late | Duplicate');
    expect(row[col('voided')]).toBe('yes');
    expect(row[col('current duration (s)')]).toBe('0');
  });

  it('flags overlapping sessions and clock-check sessions', () => {
    const a = timed('a', 'mdma', hana, local(2026, 10, 5, 10, 0), local(2026, 10, 5, 10, 10));
    const b = { ...timed('b', 'heroin', paul, local(2026, 10, 5, 10, 5), local(2026, 10, 5, 10, 15)), client_clock_offset_s: 3600 };
    const c = timed('c', 'mdma', hana, local(2026, 10, 6, 10, 0), local(2026, 10, 6, 10, 10));
    const rows = body(build([a, b, c]));
    const flagsOf = (date: string, odour: string) =>
      rows.find((r) => r[col('date')] === date && r[col('odour')] === odour)![col('flags')];
    expect(flagsOf('2026-10-05', 'MDMA')).toBe('Overlap');
    expect(flagsOf('2026-10-05', 'Heroin')).toBe('Overlap | Clock check');
    expect(flagsOf('2026-10-06', 'MDMA')).toBe('');
  });

  it('does not flag a voided session, or the one that overlapped only with it', () => {
    const a = timed('a', 'mdma', hana, local(2026, 10, 5, 10, 0), local(2026, 10, 5, 10, 10));
    const b = timed('b', 'mdma', paul, local(2026, 10, 5, 10, 5), local(2026, 10, 5, 10, 15));
    const rows = body(build([a, b], [fix('c1', 'b', '2026-10-06T10:00:00Z', { void: true, reason: 'x' })]));
    rows.forEach((r) => expect(r[col('flags')]).toBe(''));
  });

  it('orders rows by dog name, then oldest first', () => {
    const rows = body(build([
      manual('1', 'mdma', hana, '2026-10-09', 60),
      manual('2', 'tnt', hana, '2026-10-02', 60, 'd2'),
      manual('3', 'mdma', hana, '2026-10-01', 60),
      manual('4', 'tnt', hana, '2026-10-08', 60, 'd2'),
    ]));
    expect(rows.map((r) => `${r[col('dog')]} ${r[col('date')]}`)).toEqual([
      'Bella 2026-10-02', 'Bella 2026-10-08', 'Rex 2026-10-01', 'Rex 2026-10-09',
    ]);
  });

  describe('RFC 4180 quoting', () => {
    it('quotes commas, quotes and line breaks, and round-trips them', () => {
      const awkward = dog('d3', 'Rex, "the Dog"\nJr.');
      const csv = build(
        [manual('a', 'mdma', member('mQ', 'O"Hara, Pat'), '2026-10-03', 600, 'd3')],
        [fix('c1', 'a', '2026-10-04T10:00:00Z', { new_duration_s: 300, reason: 'Said "ten",\nmeant five' })],
        [awkward], [tess, member('mQ', 'O"Hara, Pat')],
      );
      expect(csv).toContain('"Rex, ""the Dog""\nJr."');
      const [row] = body(csv);
      expect(row[col('dog')]).toBe('Rex, "the Dog"\nJr.');
      expect(row[col('handler')]).toBe('O"Hara, Pat');
      expect(row[col('correction reasons')]).toBe('Said "ten",\nmeant five');
      expect(row).toHaveLength(CSV_HEADER.length);
    });

    it('leaves plain fields unquoted and keeps accents as they are', () => {
      const csv = build([manual('a', 'mdma', member('mQ', 'Rémi'), '2026-10-03', 600)], [], [rex], [member('mQ', 'Rémi')]);
      expect(csv).toContain('Rex,no,Narcotics,MDMA,Rémi,manual,2026-10-03,,,10:00,600,10:00,600,no,,');
    });

    it('stops a spreadsheet from running a name or reason that starts like a formula', () => {
      const csv = build(
        [manual('a', 'mdma', member('mQ', '=HYPERLINK("http://x")'), '2026-10-03', 600)],
        [fix('c1', 'a', '2026-10-04T10:00:00Z', { new_duration_s: 300, reason: '+1 minute' })],
        [rex], [member('mQ', '=HYPERLINK("http://x")')],
      );
      const [row] = body(csv);
      expect(row[col('handler')]).toBe('\'=HYPERLINK("http://x")');
      expect(row[col('correction reasons')]).toBe("'+1 minute");
    });
  });

  it('names a handler who is not in the list "Unknown" and an unlisted odour by its id', () => {
    const [row] = body(build([{ ...manual('a', 'mdma', hana, '2026-10-03', 60), handler_id: 'ghost', odour_id: 'old-odour' }]));
    expect(row[col('handler')]).toBe('Unknown');
    expect(row[col('odour')]).toBe('old-odour');
    expect(row[col('group')]).toBe('');
  });
});
