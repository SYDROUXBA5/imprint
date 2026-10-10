import type { ReactNode } from 'react';
import { IMPRINT_TARGET_S } from '../../domain/totals';
import { percentOfTarget } from './percent';

export function CompassRing({ totalS, children }: { totalS: number; children: ReactNode }) {
  const pct = percentOfTarget(totalS);
  const r = 100, c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, totalS) / IMPRINT_TARGET_S);
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
         aria-label="Progress toward 75 minutes" className="compass-ring"
         style={{ position: 'relative', width: 260, height: 260, maxWidth: '100%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" aria-hidden="true">
        <g transform="translate(130 130)">
          {ticks.map((i) => (
            <line key={i} x1="0" y1={i % 5 === 0 ? -124 : -120} x2="0" y2="-114"
                  stroke="var(--ink)" strokeWidth={i % 5 === 0 ? 2 : 1}
                  transform={`rotate(${i * 6})`} />
          ))}
          <circle r={r} fill="none" stroke="var(--rule)" strokeWidth="18" />
          <circle r={r} fill="none" stroke="var(--olive)" strokeWidth="18"
                  strokeDasharray={`${frac * c} ${c}`} transform="rotate(-90)" />
          <circle r={r + 9} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
          <circle r={r - 9} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
        </g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
}
