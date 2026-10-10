import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../data/db';
import { archiveDog, renameDog } from '../../data/repo';
import { formatMinutesOfTarget } from '../../domain/format';
import { odoursIn, odourById, type OdourGroup } from '../../domain/odours';
import { IMPRINT_TARGET_S, isImprinted, isRunning, odourTotal } from '../../domain/totals';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { HeaderBar } from '../components/HeaderBar';
import { ImprintedStamp } from '../components/ImprintedStamp';
import { PillToggle } from '../components/PillToggle';
import { ProgressBar } from '../components/ProgressBar';
import { Sheet } from '../components/Sheet';

const isGroup = (v: string | null): v is OdourGroup => v === 'narcotics' || v === 'explosives';

export function DogScreen() {
  const { dogId } = useParams();
  const me = useMe();
  const { dogs, sessions, corrections, loading } = useUnitData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');

  const dog = dogs.find((d) => d.id === dogId);
  const runningHere = useMemo(
    () => sessions.find((s) => s.dog_id === dogId && isRunning(s, corrections)),
    [sessions, corrections, dogId],
  );
  // Only tick while a timer is running on this dog; otherwise nothing on screen can change with time.
  const now = useNow(runningHere ? 1000 : null);

  if (loading || !me) return null;
  if (!dog) return <Navigate to="/" replace />;

  const urlGroup = params.get('group');
  const group: OdourGroup = isGroup(urlGroup)
    ? urlGroup
    : (runningHere && odourById(runningHere.odour_id)?.group) || 'narcotics';
  const isTrainer = me.role === 'trainer';
  const trainerCtx = { db, me };

  async function rename(e: FormEvent) {
    e.preventDefault();
    try {
      await renameDog(trainerCtx, dog!.id, newName);
      setRenaming(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the dog.');
    }
  }

  function askToArchive() {
    setError('');
    if (runningHere) { setBlocked(true); return; }
    setConfirming(true);
  }

  async function archive() {
    try {
      await archiveDog(trainerCtx, dog!.id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive the dog.');
    }
  }

  return (
    <div className="screen">
      <HeaderBar title={dog.name} onBack={() => navigate('/')}
        right={
          <Link to={`/dog/${dog.id}/log`}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--tap)', padding: '0 12px', textDecoration: 'none' }}>
            Log
          </Link>
        } />
      <main className="pad">
        <PillToggle value={group} onChange={(g) => setParams({ group: g }, { replace: true })} />

        <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 12 }}>
          {odoursIn(group).map((odour) => {
            const total = odourTotal(sessions, corrections, dog.id, odour.id, now);
            const imprinted = isImprinted(total);
            const runningThis = runningHere?.odour_id === odour.id;
            return (
              <li key={odour.id}>
                <Link to={`/dog/${dog.id}/timer/${odour.id}`}
                  aria-label={imprinted
                    ? `${odour.name}, imprinted`
                    : `${odour.name}, ${Math.floor(total / 60)} of ${IMPRINT_TARGET_S / 60} minutes`}
                  style={{
                    display: 'block', minHeight: 64, padding: '10px 12px', textDecoration: 'none',
                    border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)',
                  }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 36 }}>
                    <span data-odour-name style={{ fontSize: 20, fontWeight: 800 }}>{odour.name}</span>
                    {runningThis && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 800, color: 'var(--mustard)' }}>
                        <span data-testid="running-dot" aria-hidden="true" style={{
                          width: 10, height: 10, borderRadius: '50%', background: 'var(--stamp)',
                        }} />
                        Running
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {imprinted
                      ? <ImprintedStamp size="row" />
                      : <span className="num" style={{ fontWeight: 800 }}>{formatMinutesOfTarget(total)}</span>}
                  </span>
                  <ProgressBar valueS={total} label={odour.name} />
                </Link>
              </li>
            );
          })}
        </ul>

        {isTrainer && (
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button type="button" className="btn" style={{ flex: 1 }}
              onClick={() => { setNewName(dog.name); setError(''); setRenaming(true); }}>
              Rename
            </button>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={askToArchive}>Archive</button>
          </div>
        )}
        {isTrainer && blocked && runningHere && (
          <p role="alert" className="error">Stop the running timer before archiving</p>
        )}
      </main>

      <Sheet open={renaming} onClose={() => setRenaming(false)} title="Rename dog">
        <form onSubmit={rename}>
          <label className="label" htmlFor="rename-dog">Dog name</label>
          <input id="rename-dog" className="field" value={newName} autoComplete="off"
            onChange={(e) => setNewName(e.target.value)} />
          {error && renaming && <p role="alert" className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={!newName.trim()}
            style={{ width: '100%', marginTop: 16 }}>
            Save name
          </button>
        </form>
      </Sheet>

      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Archive dog">
        <p style={{ fontSize: 18 }}>
          {`Archive ${dog.name}? It disappears from the list; you can restore it from Archived.`}
        </p>
        {error && confirming && <p role="alert" className="error">{error}</p>}
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setConfirming(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={archive}>
            {`Archive ${dog.name}`}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
