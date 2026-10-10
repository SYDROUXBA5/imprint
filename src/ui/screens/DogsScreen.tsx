import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../data/db';
import { addDog } from '../../data/repo';
import { syncStatus, takeNotices } from '../../data/sync';
import { progressLine } from '../../domain/progress';
import { odourById } from '../../domain/odours';
import { isRunning } from '../../domain/totals';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { Card } from '../components/Card';
import { DogDrawing } from '../components/DogDrawing';
import { HeaderBar } from '../components/HeaderBar';
import { Monogram } from '../components/Monogram';
import { RunningBanner, type RunningItem } from '../components/RunningBanner';
import { Sheet } from '../components/Sheet';
import { SyncBadge } from '../components/SyncBadge';

const NO_SYNC = { pending: 0, rejected: 0, stale: false };

export function DogsScreen() {
  const me = useMe();
  const { dogs, archivedDogs, members, sessions, corrections, loading } = useUnitData();
  const navigate = useNavigate();
  const sync = useLiveQuery(() => syncStatus(db), [], NO_SYNC);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [notices, setNotices] = useState<string[]>([]);

  // Reading clears them, so keep what we get (and never overwrite it with the empty second read).
  useEffect(() => {
    void takeNotices(db).then((n) => { if (n.length) setNotices((prev) => [...prev, ...n]); });
  }, []);

  const running = useMemo(() => {
    const names = new Map(members.map((m) => [m.id, m.name]));
    const dogNames = new Map(dogs.map((d) => [d.id, d.name]));
    const items: RunningItem[] = [];
    for (const s of sessions) {
      if (!isRunning(s, corrections) || !dogNames.has(s.dog_id)) continue;
      items.push({
        dog: dogNames.get(s.dog_id)!, odour: odourById(s.odour_id)?.name ?? s.odour_id,
        handler: names.get(s.handler_id) ?? 'Someone', startedAt: s.started_at!,
      });
    }
    return items.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [dogs, members, sessions, corrections]);

  const now = useNow(running.length > 0 ? 1000 : null);

  if (!me) return null;
  const isTrainer = me.role === 'trainer';

  async function submitDog(e: FormEvent) {
    e.preventDefault();
    try {
      await addDog({ db, me: me! }, newName);
      setAdding(false);
      setNewName('');
      setAddError('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add the dog.');
    }
  }

  return (
    <div className="screen">
      <HeaderBar title="Dogs" right={isTrainer ? (
        <Link to="/team" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--tap)', padding: '0 12px', textDecoration: 'none' }}>
          Team
        </Link>
      ) : undefined} />
      <RunningBanner items={running} />
      <SyncBadge {...sync} />
      {notices.map((n) => (
        <div key={n} role="status" style={{
          margin: '8px 16px', padding: '8px 12px', border: '1.5px solid var(--ink)', borderRadius: 10,
          background: 'var(--paper)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700,
        }}>
          <span style={{ flex: 1 }}>{n}</span>
          <button type="button" className="btn" onClick={() => setNotices((prev) => prev.filter((x) => x !== n))}>
            Dismiss
          </button>
        </div>
      ))}

      <main className="pad">
        <p style={{ margin: '0 0 12px', textAlign: 'center', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          Trainer&rsquo;s field guide
        </p>
        {isTrainer && (
          <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 12 }}
            onClick={() => setAdding(true)}>
            + Add dog
          </button>
        )}

        {!loading && dogs.length === 0 && (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '24px 0', textAlign: 'center' }}>
            <DogDrawing />
            <h2 style={{ fontSize: 22 }}>No dogs yet</h2>
            {isTrainer && <p style={{ margin: 0 }}>Add your first dog</p>}
          </div>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {dogs.map((d) => {
            const line = progressLine(d.id, sessions, corrections, now);
            return (
              <li key={d.id}>
                <Card onClick={() => navigate(`/dog/${d.id}`)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Monogram name={d.name} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 24, fontWeight: 800, overflowWrap: 'anywhere' }}>{d.name}</span>
                      <span className="num" style={{
                        display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      }}>
                        {line || 'Nothing logged yet'}
                      </span>
                    </span>
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>

        {isTrainer && archivedDogs.length > 0 && (
          <Link to="/archived" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'var(--tap)', marginTop: 16,
            fontWeight: 800, textDecoration: 'underline',
          }}>
            {`Archived (${archivedDogs.length})`}
          </Link>
        )}
      </main>

      <Sheet open={adding} onClose={() => { setAdding(false); setAddError(''); }} title="Add dog">
        <form onSubmit={submitDog}>
          <label className="label" htmlFor="dog-name">Dog name</label>
          <input id="dog-name" className="field" value={newName} autoComplete="off"
            onChange={(e) => setNewName(e.target.value)} />
          {addError && <p role="alert" className="error">{addError}</p>}
          <button type="submit" className="btn btn-primary" disabled={!newName.trim()}
            style={{ width: '100%', marginTop: 16 }}>
            Add dog
          </button>
        </form>
      </Sheet>
    </div>
  );
}
