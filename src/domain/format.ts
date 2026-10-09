import { IMPRINT_TARGET_S } from './totals';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export const formatMinutesOfTarget = (totalS: number): string =>
  `${Math.floor(totalS / 60)}/${IMPRINT_TARGET_S / 60}`;

export const localDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
