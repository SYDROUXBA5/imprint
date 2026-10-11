import { useState, type FormEvent } from 'react';
import { db } from '../../data/db';
import { addCorrection } from '../../data/repo';
import { formatClock } from '../../domain/format';
import type { Me } from '../../domain/types';
import { Sheet } from '../components/Sheet';

interface CorrectionSheetProps {
  me: Me;
  sessionId: string;
  /** One line saying which session this is, e.g. "MDMA · 1 Oct 2026 · Hana". */
  summary: string;
  /** What the session counts for now, in seconds; the fields start from it. */
  currentS: number;
  mode: 'correct' | 'void';
  onClose: () => void;
}

const DIGITS = /^\d+$/;

/** Trainer-only. "Correct" takes a new duration; "Void" takes only the reason. Both keep the old record. */
export function CorrectionSheet({ me, sessionId, summary, currentS, mode, onClose }: CorrectionSheetProps) {
  const [minutes, setMinutes] = useState(String(Math.floor(currentS / 60)));
  const [seconds, setSeconds] = useState(String(currentS % 60));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isVoid = mode === 'void';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    let newDurationS = 0;
    if (!isVoid) {
      const m = minutes.trim() || '0';
      const s = seconds.trim() || '0';
      if (!DIGITS.test(m)) { setError('Enter whole minutes, 0 or more'); return; }
      if (!DIGITS.test(s) || Number(s) > 59) { setError('Seconds must be a whole number from 0 to 59'); return; }
      newDurationS = Number(m) * 60 + Number(s);
    }
    if (!reason.trim()) { setError('A reason is required'); return; }
    setBusy(true);
    setError('');
    try {
      await addCorrection({ db, me }, sessionId,
        isVoid ? { void: true, reason } : { void: false, newDurationS, reason });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={isVoid ? 'Void session' : 'Correct session'}>
      <form onSubmit={submit} noValidate>
        <p className="num" style={{ margin: '8px 0 0', fontWeight: 700, fontSize: 15, overflowWrap: 'anywhere' }}>{summary}</p>
        <p className="hint">
          {isVoid
            ? 'It will count as 0:00. The original stays in the history.'
            : `Counts as ${formatClock(currentS)} now. The original stays in the history.`}
        </p>

        {!isVoid && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label" htmlFor="corr-min">Minutes</label>
              <input id="corr-min" className="field num" type="text" inputMode="numeric" autoComplete="off"
                value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="corr-sec">Seconds</label>
              <input id="corr-sec" className="field num" type="text" inputMode="numeric" autoComplete="off"
                value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            </div>
          </div>
        )}

        <label className="label" htmlFor="corr-reason">Reason</label>
        <textarea id="corr-reason" className="field" rows={2} value={reason}
          style={{ resize: 'vertical' }}
          onChange={(e) => setReason(e.target.value)} />

        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" className={`btn btn-primary btn-block${isVoid ? ' btn-danger' : ''}`} disabled={busy} style={{ marginTop: 20 }}>
          {isVoid ? 'Void session' : 'Save correction'}
        </button>
      </form>
    </Sheet>
  );
}
