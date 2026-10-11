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
    <p role="status" className="note" style={{ margin: '0 0 10px' }}>
      {n === 1
        ? '1 item not synced yet. It is in this export, but other phones will not have it until this phone has signal.'
        : `${n} items not synced yet. They are in this export, but other phones will not have them until this phone has signal.`}
    </p>
  );
}

/**
 * Makes a file on the phone and hands it to the share sheet (or downloads it). Trainer screens only.
 * Each button warns about unsynced items above itself; where several sit together, pass `note={false}` to
 * all of them and put one <UnsyncedNote /> above the group. It renders a fragment, so it can sit in a grid:
 * the messages under the button take the full row (`.span-all`). `shortLabel` is what is printed on the button
 * when the room is tight; `label` stays its accessible name.
 */
export function ExportButton({ label, shortLabel, run, note = true, block = true }: {
  label: string;
  shortLabel?: string;
  run: () => Promise<ExportDone>;
  note?: boolean;
  block?: boolean;
}) {
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
    <>
      {note && <UnsyncedNote />}
      <button type="button" className={`btn${block ? ' btn-block' : ''}`} disabled={busy} onClick={click}
        aria-label={!busy && shortLabel ? label : undefined}>
        {busy ? 'Preparing…' : shortLabel ?? label}
      </button>
      {saved && <p role="status" className="hint span-all">Saved to your downloads.</p>}
      {error && <p role="alert" className="error span-all">{error}</p>}
    </>
  );
}
