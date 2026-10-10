import type { CSSProperties } from 'react';

/** "1 dog", "3 dogs", "0 dogs". */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A text link with a full-size tap target, centred. */
export const linkButton: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'var(--tap)', fontWeight: 800,
};
