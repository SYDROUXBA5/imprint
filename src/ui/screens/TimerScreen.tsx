import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../data/db';
import { AlreadyRunningError, startSession, stopSession } from '../../data/repo';
import { formatClock, formatMinutesOfTarget } from '../../domain/format';
import { odourById } from '../../domain/odours';
import { IMPRINT_TARGET_S, isRunning, liveElapsed, odourTotal } from '../../domain/totals';
import type { Session } from '../../domain/types';
import { useCrossedTarget } from '../../hooks/useCrossedTarget';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { CompassRing } from '../components/CompassRing';
import { ManualEntrySheet } from './ManualEntrySheet';

export function TimerScreen() {
  const { dogId = '', odourId = '' } = useParams();
  const me = useMe();
  const { dogs, members, sessions, corrections, loading } = useUnitData();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addedS, setAddedS] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const dog = dogs.find((d) => d.id === dogId);
  const odour = odourById(odourId);
  // One timer per dog at a time, whatever the odour: that session decides what this screen offers.
  const runningOnDog = useMemo(
    () => sessions.find((s) => s.dog_id === dogId && isRunning(s, corrections)),
    [sessions, corrections, dogId],
  );
  const runningHere = runningOnDog?.odour_id === odourId ? runningOnDog : undefined;
  const now = useNow(runningHere ? 1000 : null);

  const total = odourTotal(sessions, corrections, dogId, odourId, now);
  const [celebrate] = useCrossedTarget(total, !loading);

  if (loading || !me) return null;
  if (!dog) return <Navigate to="/" replace />;
  if (!odour) return <Navigate to={`/dog/${dog.id}`} replace />;

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';
  const alreadyRunning = (s: Session) =>
    `${s.handler_id === me.id ? 'You are' : `${nameOf(s.handler_id)} is`} already running ` +
    `${odourById(s.odour_id)?.name ?? s.odour_id} on ${dog.name}.`;

  const canStop = !!runningHere && runningHere.handler_id === me.id; // only the handler who started it can stop it
  const blocked = !!runningOnDog && !canStop;
  const sessionClock = formatClock(runningHere ? liveElapsed(runningHere, corrections, now) : 0);
  const ctx = { db, me };

  const back = () =>
    location.key !== 'default' ? navigate(-1) : navigate(`/dog/${dog.id}?group=${odour.group}`, { replace: true });

  async function start() {
    setBusy(true);
    setError('');
    setAddedS(null);
    try {
      await startSession(ctx, dog!.id, odour!.id);
    } catch (e) {
      setError(e instanceof AlreadyRunningError ? alreadyRunning(e.running) : e instanceof Error ? e.message : 'Could not start.');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!runningHere) return;
    setBusy(true);
    setError('');
    try {
      const saved = await stopSession(ctx, runningHere.id);
      setAddedS(saved.duration_s ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div style={{ padding: 'env(safe-area-inset-top) 8px 0' }}>
        <button type="button" aria-label="Back" onClick={back}
          style={{ width: 'var(--tap)', background: 'none', border: 0, padding: 0, display: 'grid', placeItems: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--ink)"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 14H5M13 6l-8 8 8 8" />
          </svg>
        </button>
      </div>
      <main className="pad" data-celebrating={celebrate ? 'true' : 'false'}
        style={{ display: 'grid', justifyItems: 'center', gap: 16, textAlign: 'center' }}>
        <header>
          <h1 style={{ fontSize: 36, lineHeight: 1.1, overflowWrap: 'anywhere' }}>
            <span aria-hidden="true">•</span> {dog.name} <span aria-hidden="true">•</span>
          </h1>
          <h2 style={{ fontSize: 40, lineHeight: 1.1, overflowWrap: 'anywhere' }}>{odour.name}</h2>
        </header>

        <CompassRing totalS={total}>
          <div>
            <div data-testid="session-clock" className="num"
              style={{ fontSize: sessionClock.length > 5 ? 44 : 64, fontWeight: 800, lineHeight: 1 }}>
              {sessionClock}
            </div>
            <div className="num" style={{ marginTop: 8, fontSize: 16, fontWeight: 800 }}>
              {`${Math.floor(total / 60)} / ${IMPRINT_TARGET_S / 60} min total`}
            </div>
          </div>
        </CompassRing>

        {canStop ? (
          <button type="button" className="btn btn-primary" onClick={stop} disabled={busy}
            style={{ width: '100%', minHeight: 64, fontSize: 28 }}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy || blocked}
            style={{ width: '100%', minHeight: 64, fontSize: 28 }}>
            Start
          </button>
        )}

        {blocked && runningOnDog && (
          <div role="status">
            <p style={{ margin: 0, fontWeight: 800 }}>{alreadyRunning(runningOnDog)}</p>
            {runningOnDog.handler_id === me.id && !runningHere && (
              <Link to={`/dog/${dog.id}/timer/${runningOnDog.odour_id}`} style={{ fontWeight: 800 }}>
                {`Open the ${odourById(runningOnDog.odour_id)?.name ?? 'running'} timer`}
              </Link>
            )}
          </div>
        )}
        {error && <p role="alert" className="error" style={{ margin: 0 }}>{error}</p>}
        {addedS !== null && !runningHere && (
          <p role="status" className="num" style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
            {`+${Math.floor(addedS / 60)} min · now ${formatMinutesOfTarget(total)}`}
          </p>
        )}

        <button type="button" onClick={() => setManualOpen(true)}
          style={{ background: 'none', border: 0, padding: '0 8px', fontSize: 17, fontWeight: 800, textDecoration: 'underline' }}>
          Add a session I forgot to time
        </button>
      </main>
      <ManualEntrySheet open={manualOpen} onClose={() => setManualOpen(false)} />
    </div>
  );
}
