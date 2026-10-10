import { useState } from 'react';
import { breedLabel } from '../../domain/breeds';
import type { BreedId } from '../../domain/types';

export interface BreedPortraitProps {
  breed: BreedId;
  size: 'sm' | 'md' | 'lg';
  /**
   * Whether the drawing should play its entrance (ink reveal, stamp settle, then the sniff loop). The art
   * files and the animation arrive with task B5; until then it is only reported in `data-play`.
   */
  play: boolean;
}

/** Edge of the square drawing, in px: small on cards, medium in the dog header, large in the picker. */
const EDGE = { sm: 72, md: 112, lg: 192 } as const;

/**
 * The ink drawing of a breed (public/breeds/<id>.webp), multiplied into the ruled paper. If the file is
 * missing or will not load, a plain ink paw stands in so the layout does not jump.
 */
export function BreedPortrait({ breed, size, play }: BreedPortraitProps) {
  const label = breedLabel(breed);
  const edge = EDGE[size];
  // Remember which breed failed, so choosing another one tries its file afresh.
  const [failedFor, setFailedFor] = useState<BreedId | null>(null);
  const failed = failedFor === breed;

  return (
    <span data-breed-portrait data-size={size} data-play={play ? 'true' : 'false'}
      style={{ display: 'inline-block', flex: 'none', width: edge, height: edge, lineHeight: 0 }}>
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
  );
}
