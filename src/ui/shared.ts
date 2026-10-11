import type { CSSProperties } from 'react';

/** "1 dog", "3 dogs", "0 dogs". */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A team's dog count: "2 of 6 dogs" when it has a planned size, "2 dogs" (and "1 dog") when it has none. The count
 * is of the dogs that are there; the planned size is only what the team is meant to hold. A team stored before the
 * field existed has no such key, which counts as none.
 */
export const dogCountText = (count: number, planned: number | null | undefined): string =>
  planned == null ? plural(count, 'dog') : `${count} of ${plural(planned, 'dog')}`;

/** A team shows a dot per place only while it plans for no more than this many dogs. */
export const MAX_DOTS = 12;

/**
 * The capacity dots of a team: one filled dot per dog that is there, one outlined dot per planned place still
 * free. `null` (text alone) when the team has no planned size or plans for more than {@link MAX_DOTS}.
 */
export function capacityDots(count: number, planned: number | null | undefined): { filled: number; empty: number } | null {
  if (planned == null || planned > MAX_DOTS) return null;
  return { filled: count, empty: Math.max(0, planned - count) };
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** "Three more places in this team." for the places a team still has free; empty when it has none or no plan. */
export function freePlacesText(count: number, planned: number | null | undefined): string {
  const free = planned == null ? 0 : planned - count;
  if (free <= 0) return '';
  const n = free < NUMBER_WORDS.length ? NUMBER_WORDS[free] : String(free);
  return `${n[0].toUpperCase()}${n.slice(1)} more ${free === 1 ? 'place' : 'places'} in this team.`;
}

/**
 * A footer that stays at the bottom of a long, scrolling sheet, so its main button is never out of reach.
 * It extends over the sheet's bottom padding (20px plus the safe area), so no content shows beneath it.
 */
const SHEET_PAD = 'calc(20px + env(safe-area-inset-bottom))';
export const stickyFooter: CSSProperties = {
  position: 'sticky', bottom: `calc(-1 * ${SHEET_PAD})`, marginTop: 12, marginBottom: `calc(-1 * ${SHEET_PAD})`,
  padding: `12px 0 ${SHEET_PAD}`, background: 'var(--paper)', borderTop: '1px solid var(--rule)',
};
