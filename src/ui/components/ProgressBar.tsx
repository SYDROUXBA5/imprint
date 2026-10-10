import { IMPRINT_TARGET_S } from '../../domain/totals';
import { percentOfTarget } from './percent';

export function ProgressBar({ valueS, label }: { valueS: number; label: string }) {
  const fill = Math.min(100, (Math.max(0, valueS) * 100) / IMPRINT_TARGET_S);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percentOfTarget(valueS)}
      aria-valuetext={`${Math.floor(Math.max(0, valueS) / 60)} of ${IMPRINT_TARGET_S / 60} minutes`}
      style={{
        height: 18, border: '1.5px solid var(--ink)', borderRadius: 999,
        background: 'var(--paper)', overflow: 'hidden',
      }}>
      <div style={{ width: `${fill}%`, height: '100%', background: 'var(--olive)' }} />
    </div>
  );
}
