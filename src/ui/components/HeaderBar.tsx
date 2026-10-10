import type { ReactNode } from 'react';

export function HeaderBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header style={{
      background: 'var(--mustard)', borderBottom: '1.5px solid var(--ink)',
      padding: 'env(safe-area-inset-top) 8px 0',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
        minHeight: 64, gap: 8,
      }}>
        <div style={{ justifySelf: 'start' }}>
          {onBack && (
            <button type="button" aria-label="Back" onClick={onBack}
              style={{ width: 'var(--tap)', background: 'none', border: 0, padding: 0, display: 'grid', placeItems: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--ink)"
                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 14H5M13 6l-8 8 8 8" />
              </svg>
            </button>
          )}
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, textAlign: 'center', overflowWrap: 'anywhere' }}>{title}</h1>
        <div style={{ justifySelf: 'end', fontWeight: 800 }}>{right}</div>
      </div>
    </header>
  );
}
