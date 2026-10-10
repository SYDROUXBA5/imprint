import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../data/db';
import { syncStatus } from '../../data/sync';
import type { ExportDone } from '../../export/run';

const NO_SYNC = { pending: 0, rejected: 0, stale: false };

/** Records that have not reached the server yet. They are on this phone, so they are in the export. */
export function UnsyncedNote() {
  const sync = useLiveQuery(() => syncStatus(db), [], NO_SYNC);
  const n = sync.pending + sync.rejected;
  if (n === 0) return null;
  return (
    <p role="status" style={{
      margin: '0 0 10px', padding: '8px 12px', border: '1.5px solid var(--ink)', borderRadius: 10,
      background: 'var(--paper)', fontWeight: 700,
    }}>
      {n === 1
        ? '1 item not synced yet. It is in this export, but other phones will not have it until this phone has signal.'
        : `${n} items not synced yet. They are in this export, but other phones will not have them until this phone has signal.`}
    </p>
  );
}

/**
 * Makes a file on the phone and hands it to the share sheet (or downloads it). Trainer screens only.
 * Each button warns about unsynced items above itself; where several sit together, pass `note={false}` to
 * all of them and put one <UnsyncedNote /> above the group.
 */
export function ExportButton({ label, run, note = true }: { label: string; run: () => Promise<ExportDone>; note?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function click() {
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      const done = await run();
      if (done.outcome === 'downloaded') setSaved(true);
    } catch {
      setError('Could not make the file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {note && <UnsyncedNote />}
      <button type="button" className="btn" style={{ width: '100%' }} disabled={busy} onClick={click}>
        {busy ? 'Preparing…' : label}
      </button>
      {saved && <p role="status" style={{ margin: '8px 0 0', fontWeight: 700 }}>Saved to your downloads.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}
