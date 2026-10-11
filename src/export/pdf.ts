import { breedLabel, purposeLabel } from '../domain/breeds';
import { formatDay, formatMinSec, localDate } from '../domain/format';
import { sortCategories, sortOdours } from '../domain/odours';
import { IMPRINT_TARGET_S, latestCorrection, odourTotal } from '../domain/totals';
import type { Correction, Dog, Odour, OdourCategory, Session, Team, TeamOdour } from '../domain/types';
import { imprintedDate } from './imprintedDate';
import { reportOdours } from './reportOdours';

export interface DogReportInput {
  dog: Dog;
  unitName: string;
  /** Shown after the unit in the page header, when there is one. */
  teamName?: string;
  generatedBy: string;
  generatedAt: Date;
  /** This dog's sessions and the corrections to them. Rows for other dogs are ignored. */
  sessions: Session[];
  corrections: Correction[];
  /** The categories and, in `odours`, exactly the odours to list: the caller picks them (a category with none is left out). */
  categories: OdourCategory[];
  odours: Odour[];
}

/** The standard PDF fonts draw Latin-1 only. Anything else would come out as garbage, so show "?" instead. */
export const pdfSafe = (text: string): string => Array.from(text).map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : '?')).join('');

// Plate colours as RGB (the same palette as src/ui/theme.css).
const BRASS: [number, number, number] = [169, 131, 43];
const MOSS: [number, number, number] = [79, 93, 47];
const INK: [number, number, number] = [31, 28, 23];
const PAPER: [number, number, number] = [245, 241, 230];
const RULE: [number, number, number] = [207, 199, 179];
const STAMP: [number, number, number] = [176, 58, 46];

const MARGIN = 14;
const PAGE_W = 210;
const ROW_H = 8;
const PAGE_BOTTOM = 275; // mm; the footer needs the rest
// Column positions in mm.
const X_ODOUR = MARGIN + 2;
const X_TOTAL_RIGHT = 84;
const X_BAR = 92;
const BAR_W = 50;
const X_IMPRINTED = 148;
const X_SESSIONS_RIGHT = PAGE_W - MARGIN - 2;

/**
 * One A4 page: dog, breed and purpose, unit (and team), who made it and when; a table per category with one
 * row per odour (total mm:ss, bar to 75:00, date imprinted, session count); and a footer counting manual
 * sessions and corrections. jsPDF is fetched here, on first use, so it stays out of the main bundle.
 */
export async function dogReportPdf(input: DogReportInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: pdfSafe(`${input.dog.name} progress report`), creator: 'Imprint' });
  drawDogPage(doc, input);
  return doc.output('blob');
}

export interface TeamReportInput {
  team: Team;
  unitName: string;
  generatedBy: string;
  generatedAt: Date;
  /** Any dogs: the team's active ones get a page each, in name order. Archived dogs and other teams' dogs are skipped. */
  dogs: Dog[];
  sessions: Session[];
  corrections: Correction[];
  /** The whole catalogue, archived rows included, and the team's tick-boxes; each page lists what the team trains on. */
  categories: OdourCategory[];
  odours: Odour[];
  teamOdours: TeamOdour[];
}

/**
 * The team report (spec 13.6): the dog page, one per active dog of the team, with the team's categories as
 * its sections. A dog with a lot of odours may run over to a second page, as in the single-dog report.
 */
export async function teamReportPdf(input: TeamReportInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { team, unitName, generatedBy, generatedAt, categories, odours, teamOdours } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: pdfSafe(`${team.name} team report`), creator: 'Imprint' });

  const dogs = input.dogs
    .filter((d) => d.team_id === team.id && d.archived_at === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));

  if (dogs.length === 0) {
    drawHeader(doc, { title: team.name, subtitle: 'Team report', unitLine: unitName, generated: generatedLine(generatedAt, generatedBy) });
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text('No active dogs in this team.', MARGIN, 52);
    return doc.output('blob');
  }

  dogs.forEach((dog, i) => {
    if (i > 0) doc.addPage();
    const sessions = input.sessions.filter((s) => s.dog_id === dog.id);
    const mine = new Set(sessions.map((s) => s.id));
    drawDogPage(doc, {
      dog, unitName, teamName: team.name, generatedBy, generatedAt, sessions,
      corrections: input.corrections.filter((c) => mine.has(c.session_id)),
      categories, odours: reportOdours(dog, sessions, { categories, odours, teamOdours }),
    });
  });
  return doc.output('blob');
}

type Doc = InstanceType<Awaited<typeof import('jspdf')>['jsPDF']>;

const generatedLine = (at: Date, by: string) => `Generated ${formatDay(localDate(at))} by ${by}`;

/** The brass band across the top of a page: a title, then up to three smaller lines. */
function drawHeader(doc: Doc, h: { title: string; subtitle?: string; unitLine: string; generated: string }) {
  doc.setFillColor(...BRASS);
  doc.rect(0, 0, PAGE_W, 36, 'F');
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(pdfSafe(h.title), MARGIN, 14, { maxWidth: PAGE_W - 2 * MARGIN });
  doc.setFont('helvetica', 'normal');
  let y = 21.5;
  if (h.subtitle) {
    doc.setFontSize(12);
    doc.text(pdfSafe(h.subtitle), MARGIN, y);
    y += 6;
  }
  doc.setFontSize(10);
  doc.text(pdfSafe(h.unitLine), MARGIN, y);
  doc.text(pdfSafe(h.generated), MARGIN, y + 5);
}

/** Draws one dog's report from the current page of `doc` (more pages follow if the tables run long). */
function drawDogPage(doc: Doc, input: DogReportInput): void {
  const { dog, unitName, generatedBy, generatedAt, corrections } = input;
  const sessions = input.sessions.filter((s) => s.dog_id === dog.id);
  const mine = new Set(sessions.map((s) => s.id));
  const dogCorrections = corrections.filter((c) => mine.has(c.session_id));
  const isVoided = (s: Session) => latestCorrection(s.id, dogCorrections)?.void === true;

  drawHeader(doc, {
    title: dog.name,
    subtitle: `${breedLabel(dog.breed)} \u00b7 ${purposeLabel(dog.purpose)}`,
    unitLine: input.teamName ? `${unitName} \u00b7 ${input.teamName}` : unitName,
    generated: generatedLine(generatedAt, generatedBy),
  });

  let y = 48;
  const table = (heading: string, list: Odour[]) => {
    // Start a table on a new page when its heading and first two rows would not fit on this one.
    if (y + 3 + 5 + 3 + Math.min(list.length, 2) * ROW_H > PAGE_BOTTOM) { doc.addPage(); y = 20; }
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(heading, MARGIN, y);
    y += 3;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5;

    doc.setFontSize(9);
    doc.text('Odour', X_ODOUR, y);
    doc.text('Total', X_TOTAL_RIGHT, y, { align: 'right' });
    doc.text('Progress', X_BAR, y);
    doc.text('Imprinted', X_IMPRINTED, y);
    doc.text('Sessions', X_SESSIONS_RIGHT, y, { align: 'right' });
    y += 3;

    list.forEach((odour, i) => {
      if (y + ROW_H > PAGE_BOTTOM) { doc.addPage(); y = 20; } // a long table carries on over the page
      const own = sessions.filter((s) => s.odour_id === odour.id);
      const total = odourTotal(sessions, dogCorrections, dog.id, odour.id);
      const date = imprintedDate(own, dogCorrections);
      const count = own.filter((s) => !isVoided(s)).length;
      const textY = y + 5.5;

      if (i % 2 === 0) {
        doc.setFillColor(...PAPER);
        doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, ROW_H, 'F');
      }
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(pdfSafe(odour.name), X_ODOUR, textY);
      doc.setFont('helvetica', 'normal');
      doc.text(formatMinSec(total), X_TOTAL_RIGHT, textY, { align: 'right' });

      // Bar: an outlined track with a moss fill, full at 75:00.
      const frac = Math.min(1, total / IMPRINT_TARGET_S);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.rect(X_BAR, y + 2, BAR_W, 4, 'FD');
      if (frac > 0) {
        doc.setFillColor(...MOSS);
        doc.rect(X_BAR, y + 2, BAR_W * frac, 4, 'F');
        doc.rect(X_BAR, y + 2, BAR_W, 4, 'S');
      }

      if (date) {
        doc.setTextColor(...STAMP);
        doc.setFont('helvetica', 'bold');
        doc.text(formatDay(date), X_IMPRINTED, textY);
        doc.setTextColor(...INK);
        doc.setFont('helvetica', 'normal');
      }
      doc.text(String(count), X_SESSIONS_RIGHT, textY, { align: 'right' });
      y += ROW_H;
    });
    y += 8;
  };
  for (const category of sortCategories(input.categories)) {
    const list = sortOdours(input.odours.filter((o) => o.category_id === category.id));
    if (list.length > 0) table(pdfSafe(category.name), list);
  }

  // Footer
  if (y + 20 > 297 - 10) { doc.addPage(); y = 20; }
  const manual = sessions.filter((s) => s.kind === 'manual' && !isVoided(s)).length;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Manual sessions: ${manual}`, MARGIN, y);
  doc.text(`Corrections: ${dogCorrections.length}`, MARGIN + 50, y);
  doc.setFontSize(8);
  doc.text(`Imprinted = ${formatMinSec(IMPRINT_TARGET_S)} on one odour. Totals include corrections; voided sessions count as 0:00.`, MARGIN, y + 6);

}
