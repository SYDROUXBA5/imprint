import { useState } from 'react';

/** The Malinois on the entry and empty screens. If the drawing can't load, a plain pen sketch stands in. */
export function DogDrawing({ size = 200 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PenSketch size={size} />;
  return (
    <img src={`${import.meta.env.BASE_URL}malinois-face.webp`} alt="Ink drawing of a Belgian Malinois"
      width={size} height={size} style={{ objectFit: 'contain' }} onError={() => setFailed(true)} />
  );
}

/** Pen-and-ink working dog (front view): ink strokes on paper. */
function PenSketch({ size }: { size: number }) {
  return (
    <svg role="img" aria-label="Pen-and-ink drawing of a working dog" viewBox="0 0 200 200"
      width={size} height={size} fill="none" stroke="var(--ink)" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round">
      {/* ears */}
      <path d="M58 92 L44 22 C54 20 74 36 88 70" fill="var(--paper)" />
      <path d="M142 92 L156 22 C146 20 126 36 112 70" fill="var(--paper)" />
      <path d="M55 72 L51 40 C59 44 70 54 77 68" strokeWidth="2" />
      <path d="M145 72 L149 40 C141 44 130 54 123 68" strokeWidth="2" />
      {/* head */}
      <path d="M58 92 C66 66 134 66 142 92 C148 128 132 162 100 176 C68 162 52 128 58 92 Z" fill="var(--paper)" />
      <path d="M100 72 V106" strokeWidth="2" />
      {/* eyes and brows */}
      <circle cx="80" cy="96" r="4.5" fill="var(--ink)" />
      <circle cx="120" cy="96" r="4.5" fill="var(--ink)" />
      <path d="M69 86 Q80 79 91 86" strokeWidth="2.5" />
      <path d="M109 86 Q120 79 131 86" strokeWidth="2.5" />
      {/* muzzle, nose, mouth */}
      <path d="M82 108 C80 134 90 150 100 150 C110 150 120 134 118 108" strokeWidth="2.5" />
      <path d="M88 116 Q100 108 112 116 Q112 130 100 133 Q88 130 88 116 Z" fill="var(--ink)" />
      <path d="M100 133 V144 M100 144 Q92 155 82 148 M100 144 Q108 155 118 148" strokeWidth="2.5" />
      {/* cheek fur */}
      <path d="M62 118 l9 4 M60 129 l10 4 M64 140 l9 3 M138 118 l-9 4 M140 129 l-10 4 M136 140 l-9 3" strokeWidth="2" />
      {/* collar and tag */}
      <path d="M66 167 Q100 187 134 167" strokeWidth="3.5" />
      <path d="M71 177 Q100 197 129 177" strokeWidth="3.5" />
      <circle cx="100" cy="192" r="6" fill="var(--paper)" />
    </svg>
  );
}
