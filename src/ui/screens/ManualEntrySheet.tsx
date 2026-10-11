import { useState, type FormEvent } from 'react';
import { db } from '../../data/db';
import { addManualSession } from '../../data/repo';
import { crossedTarget } from '../../domain/celebration';
import { localDate } from '../../domain/format';
import { odourTotal } from '../../domain/totals';
import { useMe } from '../../hooks/useMe';
import { Sheet } from '../components/Sheet';

interface ManualEntrySheetProps {
  open: boolean;
  onClose: () => void;
  dogId: string;
  odourId: string;
  /** Called after saving when the new total takes this odour from under 75:00 to 75:00 or more. */
  onCrossed?: () => void;
}

/** The displayed total right now (stored time plus any running timer), straight from the local store. */
async function currentTotal(dogId: string, odourId: string): Promise<number> {
  const sessions = await db.sessions.where('[dog_id+odour_id]').equals([dogId, odourId]).toArray();
  const corrections = await db.corrections.where('session_id').anyOf(sessions.map((s) => s.id)).toArray();
  return odourTotal(sessions, corrections, dogId, odourId, Date.now());
}

const WHOLE_MINUTES = /^\d+$/;

function EntryForm({ dogId, odourId, onClose, onCrossed }: Omit<ManualEntrySheetProps, 'open'>) {
  const me = useMe();
  const [date, setDate] = useState(() => localDate(new Date()));
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const text = minutes.trim();
    if (!WHOLE_MINUTES.test(text) || Number(text) <= 0) { setError('Enter whole minutes above 0'); return; }
    if (!date) { setError('Pick a date'); return; }
    if (date > localDate(new Date())) { setError('The date cannot be in the future'); return; }
    if (!me) return; // not read from the local database yet
    setBusy(true);
    setError('');
    try {
      const addedS = Number(text) * 60;
      const before = await currentTotal(dogId, odourId);
      await addManualSession({ db, me }, dogId, odourId, date, Number(text));
      if (crossedTarget(before, before + addedS)) onCrossed?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the session.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="label" htmlFor="manual-date">Date</label>
      <input id="manual-date" type="date" className="field" value={date} max={localDate(new Date())}
        onChange={(e) => setDate(e.target.value)} />

      <label className="label" htmlFor="manual-minutes">Minutes</label>
      <input id="manual-minutes" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
        className="field num" value={minutes} aria-describedby="manual-hint"
        aria-invalid={error === 'Enter whole minutes above 0' ? true : undefined}
        onChange={(e) => setMinutes(e.target.value)} />
      <p id="manual-hint" className="muted" style={{ margin: '4px 0 0', fontSize: 15 }}>
        Whole minutes, for time you did not record with the timer.
      </p>

      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
        Save session
      </button>
    </form>
  );
}

export function ManualEntrySheet({ open, onClose, dogId, odourId, onCrossed }: ManualEntrySheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a session I forgot to time">
      {/* Mounted only while open, so the fields start fresh every time. */}
      <EntryForm dogId={dogId} odourId={odourId} onClose={onClose} onCrossed={onCrossed} />
    </Sheet>
  );
}
