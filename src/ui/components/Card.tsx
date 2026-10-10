import type { ReactNode } from 'react';

const base = {
  display: 'block', width: '100%', textAlign: 'left', margin: 0, padding: 14, font: 'inherit', color: 'inherit',
  border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)',
} as const;

export function Card({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  if (onClick) {
    return <button type="button" onClick={onClick} style={{ ...base, cursor: 'pointer' }}>{children}</button>;
  }
  return <div style={base}>{children}</div>;
}
