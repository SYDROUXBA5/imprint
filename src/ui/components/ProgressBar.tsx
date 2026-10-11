import { IMPRINT_TARGET_S } from '../../domain/totals';
import { percentOfTarget } from './percent';

interface ProgressBarProps {
  /** Everything counted toward the 75 minutes, a running timer's time included. */
  valueS: number;
  label: string;
  /** The part of `valueS` that belongs to a timer running right now: drawn in brass after the moss. */
  liveS?: number;
  size?: 'row' | 'large';
  /** Turns on the short glow when the odour has just crossed 75 minutes. */
  glowing?: boolean;
}

const pct = (s: number) => Math.min(100, (Math.max(0, s) * 100) / IMPRINT_TARGET_S);

/**
 * A ruled bar for the 75 minutes: a tick every 15 minutes, moss for the time logged, brass for the live part
 * of a running session. The fill is a plain width, so it needs no script to draw.
 */
export function ProgressBar({ valueS, label, liveS = 0, size = 'row', glowing = false }: ProgressBarProps) {
  const total = pct(valueS);
  const live = Math.min(total, pct(liveS));
  const logged = total - live;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percentOfTarget(valueS)}
      aria-valuetext={`${Math.floor(Math.max(0, valueS) / 60)} of ${IMPRINT_TARGET_S / 60} minutes`}
      className={`bar${size === 'large' ? ' bar-large' : ''}${glowing ? ' is-glowing' : ''}`}>
      {logged > 0 && <span className="bar-fill" data-bar-logged style={{ width: `${logged}%` }} />}
      {live > 0 && <span className="bar-fill bar-live" data-bar-live style={{ left: `${logged}%`, width: `${live}%` }} />}
      <span className="bar-ticks" />
    </div>
  );
}
