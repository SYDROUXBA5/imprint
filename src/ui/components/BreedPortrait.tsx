import { useState, useSyncExternalStore } from 'react';
import { BREED_NOSES, breedLabel } from '../../domain/breeds';
import type { BreedId } from '../../domain/types';
import './breedPortrait.css';

export interface BreedPortraitProps {
  breed: BreedId;
  size: 'sm' | 'md' | 'lg';
  /**
   * Whether the drawing should play: the ink reveal and stamp settle, then (see `idle`) the sniff loop. It
   * plays when this turns on and again whenever `breed` changes while it is on. The small size never plays,
   * and nothing plays under `prefers-reduced-motion`.
   */
  play: boolean;
  /**
   * Whether the sniff loop and scent wisps run after the reveal. Default true. The dog screen turns it off
   * while no timer is running, so the drawing plays once on open and then rests.
   */
  idle?: boolean;
}

/** Edge of the square drawing, in px: small on cards, medium in the dog header, large in the picker. */
const EDGE = { sm: 72, md: 112, lg: 192 } as const;

/**
 * Three thin hand-drawn scent wisps. Each is anchored with its right end on the nose and slides in from the
 * left (see breedPortrait.css), fading as it arrives. `len` and `rise` are fractions of the drawing's edge;
 * `dy` is the offset from the nose in the same unit; `delay` staggers them inside the 3.2 s loop.
 */
const WISPS = [
  { len: 0.3, rise: 0.07, dy: -0.07, delay: 0.9, d: 'M1 7 C5 1 9 11 14 6 S22 1 28 6 S33 7 36 5' },
  { len: 0.36, rise: 0.08, dy: -0.01, delay: 1.15, d: 'M1 5 C6 10 10 0 16 5 S25 10 31 5 S38 4 42 6' },
  { len: 0.26, rise: 0.07, dy: 0.05, delay: 1.4, d: 'M1 6 C4 11 8 2 13 6 S20 10 25 5 S29 4 31 6' },
] as const;
const WISP_VIEWBOX_WIDTH = [36, 42, 31] as const;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const mediaQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;

function subscribeReducedMotion(onChange: () => void) {
  const query = mediaQuery();
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
const reducedMotionNow = () => mediaQuery()?.matches ?? false;

/**
 * The ink drawing of a breed (public/breeds/<id>.webp), multiplied into the ruled paper. If the file is
 * missing or will not load, a plain ink paw stands in so the layout does not jump; it gets the same reveal
 * and settle, but no sniffing.
 */
export function BreedPortrait({ breed, size, play, idle = true }: BreedPortraitProps) {
  const label = breedLabel(breed);
  const edge = EDGE[size];
  const nose = BREED_NOSES[breed];
  const reduced = useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => false);
  // Remember which breed failed, so choosing another one tries its file afresh.
  const [failedFor, setFailedFor] = useState<BreedId | null>(null);
  const failed = failedFor === breed;

  const animated = play && size !== 'sm' && !reduced;
  const sniffing = animated && idle && !failed;

  // Count the plays. A new play starts when the animation switches on or the breed changes while it is on;
  // the stage below is keyed by this count, so a fresh element restarts the CSS animation.
  const [track, setTrack] = useState({ run: animated ? 1 : 0, breed, animated });
  if (track.animated !== animated || track.breed !== breed) {
    const again = animated && (!track.animated || track.breed !== breed);
    setTrack({ run: again ? track.run + 1 : track.run, breed, animated });
  }

  const classes = ['breed-portrait', animated && 'is-animated', sniffing && 'is-sniffing'].filter(Boolean).join(' ');

  return (
    <span className={classes} data-breed-portrait data-size={size} data-play={play ? 'true' : 'false'}
      data-motion={animated ? 'animated' : 'static'} data-run={track.run}
      style={{ width: edge, height: edge }}>
      <span key={track.run} className="bp-stage" data-stage>
        <span className="bp-ink">
          <span className="bp-body">
            {failed ? (
              <svg role="img" aria-label={label} viewBox="0 0 100 100" width={edge} height={edge} fill="none"
                stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M50 46 C36 46 24 62 28 74 C31 82 42 80 50 80 C58 80 69 82 72 74 C76 62 64 46 50 46 Z" fill="var(--paper)" />
                <ellipse cx="25" cy="42" rx="7" ry="10" transform="rotate(-20 25 42)" fill="var(--paper)" />
                <ellipse cx="40" cy="28" rx="7" ry="11" transform="rotate(-6 40 28)" fill="var(--paper)" />
                <ellipse cx="60" cy="28" rx="7" ry="11" transform="rotate(6 60 28)" fill="var(--paper)" />
                <ellipse cx="75" cy="42" rx="7" ry="10" transform="rotate(20 75 42)" fill="var(--paper)" />
              </svg>
            ) : (
              <img src={`${import.meta.env.BASE_URL}breeds/${breed}.webp`} alt={label} width={edge} height={edge}
                onError={() => setFailedFor(breed)}
                style={{ display: 'block', width: edge, height: edge, objectFit: 'contain', mixBlendMode: 'multiply' }} />
            )}
          </span>
        </span>
      </span>
      {sniffing && (
        // A zero-size anchor on the nose; the wisps hang off it to the left and drift in towards it.
        <span className="bp-wisps" data-wisps aria-hidden="true" style={{ left: `${nose.x}%`, top: `${nose.y}%` }}>
          {WISPS.map((w, i) => {
            const width = Math.round(edge * w.len);
            const height = Math.round(edge * w.rise);
            return (
              <svg key={i} className="bp-wisp" data-wisp viewBox={`0 0 ${WISP_VIEWBOX_WIDTH[i]} 12`}
                width={width} height={height} fill="none" stroke="var(--ink)" strokeWidth="1.1"
                strokeLinecap="round" preserveAspectRatio="none"
                style={{
                  top: Math.round(edge * w.dy - height / 2), animationDelay: `${w.delay}s`,
                  ['--drift' as string]: `${width}px`,
                }}>
                <path d={w.d} />
              </svg>
            );
          })}
        </span>
      )}
    </span>
  );
}
