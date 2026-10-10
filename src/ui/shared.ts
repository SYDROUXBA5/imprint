import type { CSSProperties } from 'react';

/** "1 dog", "3 dogs", "0 dogs". */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A text link with a full-size tap target, centred. */
export const linkButton: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'var(--tap)', fontWeight: 800,
};

/**
 * A footer that stays at the bottom of a long, scrolling sheet, so its main button is never out of reach.
 * It extends over the sheet's bottom padding (20px plus the safe area), so no content shows beneath it.
 */
const SHEET_PAD = 'calc(20px + env(safe-area-inset-bottom))';
export const stickyFooter: CSSProperties = {
  position: 'sticky', bottom: `calc(-1 * ${SHEET_PAD})`, marginTop: 12, marginBottom: `calc(-1 * ${SHEET_PAD})`,
  padding: `12px 0 ${SHEET_PAD}`, background: 'var(--paper)', borderTop: '1.5px solid var(--rule)',
};
