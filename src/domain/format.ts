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

/** Totals as minutes:seconds, e.g. 75:00 (never hours), as the target is spoken and as the exports show it. */
export function formatMinSec(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-03" -> "3 Oct 2026", or "3 Oct" without the year. Fixed English, so it reads the same on every phone. */
export function formatDay(ymd: string, withYear = true): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/**
 * A total as typed minutes and seconds: minutes padded to two digits and never turned into hours, e.g. 06:02,
 * 41:05, 75:00, 104:12.
 */
export function formatTyped(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** A running timer's elapsed time, typed and fixed-width: 07:41, and from an hour on 1:02:03 (as formatClock). */
export function formatTypedClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  return h > 0 ? formatClock(s) : formatTyped(s);
}

/** The clock time of an ISO timestamp on this phone, 24 hours: "14:32". */
export function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
