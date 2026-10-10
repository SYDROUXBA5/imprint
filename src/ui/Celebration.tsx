import { useEffect, useMemo, useRef } from 'react';
import { ImprintedStamp } from './components/ImprintedStamp';
import './celebration.css';

interface CelebrationProps {
  dog: string;
  odour: string;
  onDone: () => void;
}

const PAWS = 6;

/** Six prints leaving the centre in evenly spread directions, each 90 to 140 px out. */
function pawTrails() {
  const offset = Math.random() * 60;
  return Array.from({ length: PAWS }, (_, i) => {
    const angle = ((offset + i * (360 / PAWS) + (Math.random() * 30 - 15)) * Math.PI) / 180;
    const distance = 90 + Math.random() * 50;
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance),
      turn: Math.round((angle * 180) / Math.PI + 90),
    };
  });
}

function Paw() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="var(--ink)">
      <ellipse cx="12" cy="16" rx="6" ry="5" />
      <ellipse cx="5.5" cy="10.5" rx="2.4" ry="3" />
      <ellipse cx="10" cy="6.5" rx="2.4" ry="3.2" />
      <ellipse cx="15" cy="6.5" rx="2.4" ry="3.2" />
      <ellipse cx="19" cy="10.5" rx="2.4" ry="3" />
    </svg>
  );
}

/**
 * The 75-minute moment: ring glow (done in CSS on the screen underneath), stamp drop with an ink
 * splash, paw prints and the text, in about 2.5 s. The timer keeps running below; tap anywhere to close.
 */
export function Celebration({ dog, odour, onDone }: CelebrationProps) {
  const paws = useMemo(pawTrails, []);
  const button = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    navigator.vibrate?.([80, 40, 120]); // Android only; iPhone web apps have no vibrate
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') doneRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <button ref={button} type="button" className="celebration" onClick={onDone}>
      <span className="celebration-art">
        <span className="celebration-splash" aria-hidden="true">
          <svg viewBox="0 0 320 200" width="320" height="200">
            <path fill="var(--stamp)"
              d="M160 14c22 2 30 22 52 26 24 4 54-6 62 18 8 22-14 36-10 56 4 22 26 36 8 54-16 16-40 4-60 12-22 10-30 38-56 32-24-6-20-34-40-44-22-10-52 0-64-22-10-20 14-34 12-54-2-22-30-34-14-54 14-18 40-6 58-14 20-8 28-16 52-10z" />
          </svg>
        </span>
        <span className="celebration-stamp"><ImprintedStamp size="hero" /></span>
        <span className="celebration-stage" aria-hidden="true">
          {paws.map((p, i) => (
            <span key={i} data-paw className="celebration-paw"
              style={{ ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, ['--turn' as string]: `${p.turn}deg` }}>
              <Paw />
            </span>
          ))}
        </span>
      </span>
      <span className="celebration-text">{`${dog}: ${odour} imprinted`}</span>
      <span className="celebration-hint">Tap to continue</span>
    </button>
  );
}
