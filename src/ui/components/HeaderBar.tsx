import type { ReactNode } from 'react';
import { BackChevron } from './icons';

/**
 * The page header: a back chevron (a 48px tap target), the title in serif and, on the right, an optional typed
 * text action. Without `onBack` (the first screen of a flow) the title starts at the page edge.
 */
export function HeaderBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className={`head${onBack ? ' has-back' : ''}`}>
      {onBack && (
        <button type="button" className="head-back" aria-label="Back" onClick={onBack}>
          <BackChevron />
        </button>
      )}
      <h1>{title}</h1>
      {right && <div className="head-right">{right}</div>}
    </header>
  );
}
