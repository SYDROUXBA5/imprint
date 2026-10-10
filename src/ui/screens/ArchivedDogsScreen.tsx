import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteDogForever, restoreDog } from '../../data/actions';
import { db } from '../../data/db';
import { formatDay, localDate } from '../../domain/format';
import type { Dog } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { useOnline } from '../../hooks/useOnline';
import { useUnitData } from '../../hooks/useUnitData';
import { HeaderBar } from '../components/HeaderBar';
import { Sheet } from '../components/Sheet';

/** Trainer-only (the route sends handlers home). Restore works offline; Delete forever needs signal. */
export function ArchivedDogsScreen() {
  const me = useMe();
  const { archivedDogs, sessions, loading } = useUnitData();
  const online = useOnline();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<Dog | null>(null);
  const [error, setError] = useState('');

  if (loading || !me) return null;
  const ctx = { db, me };
  const sessionCount = (dogId: string) => sessions.filter((s) => s.dog_id === dogId).length;

  async function restore(dog: Dog) {
    setError('');
    try {
      await restoreDog(ctx, dog.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore the dog.');
    }
  }

  return (
    <div className="screen">
      <HeaderBar title="Archived" onBack={() => navigate('/')} />
      <main className="pad">
        {archivedDogs.length === 0 && (
          <p style={{ margin: '24px 0', textAlign: 'center', fontWeight: 800 }}>No archived dogs</p>
        )}
        {error && !deleting && <p role="alert" className="error">{error}</p>}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {archivedDogs.map((dog) => (
            <li key={dog.id} style={{
              padding: 14, border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)',
            }}>
              <h2 style={{ fontSize: 24, overflowWrap: 'anywhere' }}>{dog.name}</h2>
              <p className="muted" style={{ margin: '2px 0 0' }}>
                {`Archived ${formatDay(localDate(new Date(dog.archived_at!)))}`}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-primary" style={{ flex: 1 }}
                  aria-label={`Restore ${dog.name}`} onClick={() => restore(dog)}>
                  Restore
                </button>
                <button type="button" className="btn" style={{ flex: 1, color: 'var(--stamp)', borderColor: 'var(--stamp)' }}
                  aria-label={`Delete ${dog.name} forever`} disabled={!online}
                  onClick={() => { setError(''); setDeleting(dog); }}>
                  Delete forever
                </button>
              </div>
              {!online && <p className="muted" style={{ margin: '8px 0 0', fontWeight: 700 }}>Needs signal.</p>}
            </li>
          ))}
        </ul>
      </main>

      {deleting && (
        <DeleteForeverSheet key={deleting.id} dog={deleting} sessionCount={sessionCount(deleting.id)}
          online={online} onClose={() => setDeleting(null)}
          onConfirm={() => deleteDogForever(ctx, deleting.id)} />
      )}
    </div>
  );
}

interface DeleteForeverSheetProps {
  dog: Dog;
  sessionCount: number;
  online: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteForeverSheet({ dog, sessionCount, online, onClose, onConfirm }: DeleteForeverSheetProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The name must match exactly (case-sensitive), so a stray tap cannot erase a dog.
  const matches = typed.trim() === dog.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches || !online || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the dog.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Delete ${dog.name} forever?`}>
      <form onSubmit={submit}>
        <p style={{ fontSize: 18, overflowWrap: 'anywhere' }}>
          {`This erases ${dog.name} and all ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}. It cannot be undone. Type ${dog.name} to confirm.`}
        </p>
        <label className="label" htmlFor="delete-confirm">Dog name</label>
        <input id="delete-confirm" className="field" value={typed} autoComplete="off" autoCapitalize="off"
          autoCorrect="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        {!online && <p className="error">Needs signal.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={!matches || !online || busy}
            style={{ flex: 1, background: 'var(--stamp)', borderColor: 'var(--stamp)', color: 'var(--paper)' }}>
            Delete forever
          </button>
        </div>
      </form>
    </Sheet>
  );
}
