import { formatDay, formatMinSec, localDate } from '../domain/format';
import { sortCategories, sortOdours } from '../domain/odours';
import { IMPRINT_TARGET_S, latestCorrection, odourTotal } from '../domain/totals';
import type { Correction, Dog, Odour, OdourCategory, Session } from '../domain/types';
import { imprintedDate } from './imprintedDate';

export interface DogReportInput {
  dog: Dog;
  unitName: string;
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

// Field Guide colours as RGB.
const MUSTARD: [number, number, number] = [184, 144, 28];
const OLIVE: [number, number, number] = [85, 96, 31];
const INK: [number, number, number] = [30, 26, 20];
const PAPER: [number, number, number] = [245, 239, 220];
const RULE: [number, number, number] = [227, 217, 188];
const STAMP: [number, number, number] = [192, 50, 43];

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
 * One A4 page: dog, unit, who made it and when; a Narcotics and an Explosives table with one row per odour
 * (total mm:ss, bar to 75:00, date imprinted, session count); and a footer counting manual sessions and
 * corrections. jsPDF is fetched here, on first use, so it stays out of the main bundle.
 */
export async function dogReportPdf(input: DogReportInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { dog, unitName, generatedBy, generatedAt, corrections } = input;
  const sessions = input.sessions.filter((s) => s.dog_id === dog.id);
  const mine = new Set(sessions.map((s) => s.id));
  const dogCorrections = corrections.filter((c) => mine.has(c.session_id));
  const isVoided = (s: Session) => latestCorrection(s.id, dogCorrections)?.void === true;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: pdfSafe(`${dog.name} progress report`), creator: 'Imprint' });

  // Header band
  doc.setFillColor(...MUSTARD);
  doc.rect(0, 0, PAGE_W, 36, 'F');
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(pdfSafe(dog.name), MARGIN, 16, { maxWidth: PAGE_W - 2 * MARGIN });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(pdfSafe(unitName), MARGIN, 24);
  doc.setFontSize(10);
  doc.text(pdfSafe(`Generated ${formatDay(localDate(generatedAt))} by ${generatedBy}`), MARGIN, 30);

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

      // Bar: an outlined track with an olive fill, full at 75:00.
      const frac = Math.min(1, total / IMPRINT_TARGET_S);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.rect(X_BAR, y + 2, BAR_W, 4, 'FD');
      if (frac > 0) {
        doc.setFillColor(...OLIVE);
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

  return doc.output('blob');
}
