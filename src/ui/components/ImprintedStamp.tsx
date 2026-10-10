import { useId } from 'react';

/** Red rubber-stamp IMPRINTED: double border, rotated, with a slightly rough edge. */
export function ImprintedStamp({ size = 'row' }: { size?: 'row' | 'hero' }) {
  const filterId = useId();
  const width = size === 'hero' ? 280 : 112;
  return (
    <svg role="img" aria-label="Imprinted" viewBox="0 0 200 64" width={width} height={width * 0.32}
      style={{ transform: 'rotate(-8deg)', flex: 'none', mixBlendMode: 'multiply' }}>
      <defs>
        <filter id={filterId} x="-5%" y="-10%" width="110%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`} fill="none" stroke="var(--stamp)" opacity="0.92">
        <rect x="3" y="3" width="194" height="58" rx="7" strokeWidth="3.5" />
        <rect x="9.5" y="9.5" width="181" height="45" rx="3" strokeWidth="1.6" />
        <text x="100" y="42" textAnchor="middle" textLength="166" lengthAdjust="spacingAndGlyphs"
          fill="var(--stamp)" stroke="none" fontSize="29" fontWeight="800"
          fontFamily="'Nunito', system-ui, sans-serif">IMPRINTED</text>
      </g>
    </svg>
  );
}
