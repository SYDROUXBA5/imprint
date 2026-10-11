import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../data/db';
import { AlreadyRunningError, startSession, stopSession } from '../../data/repo';
import { formatMinutesOfTarget, formatTimeOfDay, formatTypedClock } from '../../domain/format';
import { NOT_IN_CURRENT_LIST, isInTeamList, odourById, odourName } from '../../domain/odours';
import { IMPRINT_TARGET_S, isRunning, liveElapsed, odourTotal } from '../../domain/totals';
import type { Session } from '../../domain/types';
import { useCrossedTarget } from '../../hooks/useCrossedTarget';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { Celebration } from '../Celebration';
import { BreedPortrait } from '../components/BreedPortrait';
import { HeaderBar } from '../components/HeaderBar';
import { ProgressBar } from '../components/ProgressBar';
import { ManualEntrySheet } from './ManualEntrySheet';

export function TimerScreen() {
  const { dogId = '', odourId = '' } = useParams();
  const me = useMe();
  const { dogs, members, sessions, corrections, odours, catalogue, loading } = useUnitData();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addedS, setAddedS] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const dog = dogs.find((d) => d.id === dogId);
  const odour = odourById(odours, odourId);
  // One timer per dog at a time, whatever the odour: that session decides what this screen offers.
  const runningOnDog = useMemo(
    () => sessions.find((s) => s.dog_id === dogId && isRunning(s, corrections)),
    [sessions, corrections, dogId],
  );
  const runningHere = runningOnDog?.odour_id === odourId ? runningOnDog : undefined;
  const now = useNow(runningHere ? 1000 : null);

  const totalS = odourTotal(sessions, corrections, dogId, odourId, now);
  const [celebrate, dismissCelebration, celebrateNow] = useCrossedTarget(totalS, !loading);

  if (loading || !me) return null;
  if (!dog) return <Navigate to="/" replace />;
  if (!odour) return <Navigate to={`/dog/${dog.id}`} replace />;

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';
  const alreadyRunning = (s: Session) =>
    `${s.handler_id === me.id ? 'You are' : `${nameOf(s.handler_id)} is`} already running ` +
    `${odourName(odours, s.odour_id)} on ${dog.name}.`;

  const canStop = !!runningHere && runningHere.handler_id === me.id; // only the handler who started it can stop it
  const blocked = !!runningOnDog && !canStop;
  const sessionClock = formatTypedClock(runningHere ? liveElapsed(runningHere, corrections, now) : 0);
  const ctx = { db, me };

  const back = () =>
    location.key !== 'default' ? navigate(-1) : navigate(`/dog/${dog.id}?cat=${odour.category_id}`, { replace: true });

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

  const total = Math.max(0, totalS);
  const doneMin = Math.floor(total / 60);
  const targetMin = IMPRINT_TARGET_S / 60;
  const liveS = runningHere ? liveElapsed(runningHere, corrections, now) : 0;
  const loggedMin = Math.floor(Math.max(0, total - liveS) / 60);

  return (
    <div className="screen">
      <HeaderBar title={odour.name} onBack={back} />
      <main className="page" data-celebrating={celebrate ? 'true' : 'false'}>
        {!isInTeamList(dog.team_id, odour.id, catalogue) && (
          <p className="hint" style={{ margin: '6px 0 0' }}>{NOT_IN_CURRENT_LIST}</p>
        )}

        <div className="band strip">
          <span className="strip-face"><BreedPortrait breed={dog.breed} size="xs" play={false} /></span>
          <div style={{ minWidth: 0 }}>
            <h2>{dog.name}</h2>
            <p>
              {runningHere?.started_at
                ? `started ${formatTimeOfDay(runningHere.started_at)} by ${nameOf(runningHere.handler_id)}`
                : 'not running'}
            </p>
          </div>
        </div>

        <div className="session">
          <div className="caps">This session</div>
          <div data-testid="session-clock" className="numerals" style={{ ['--chars' as string]: sessionClock.length }}>
            {sessionClock}
          </div>
        </div>

        <div className="timer-progress">
          <div className="timer-progress-head">
            <b>{`${doneMin} of ${targetMin} minutes`}</b>
            <i>{doneMin >= targetMin ? 'imprinted' : `${targetMin - doneMin} to go`}</i>
          </div>
          <ProgressBar valueS={total} liveS={liveS} size="large" glowing={celebrate} label="Progress toward 75 minutes" />
          <div className="bar-scale" aria-hidden="true">
            {[0, 15, 30, 45, 60, 75].map((m) => <span key={m}>{m}</span>)}
          </div>
          <div className="bar-legend">
            <span><i style={{ background: 'var(--moss)' }} />{`logged before, ${loggedMin} min`}</span>
            <span><i style={{ background: 'var(--brass)' }} />{`now, ${Math.floor(liveS / 60)} min`}</span>
          </div>
        </div>

        <div className="timer-actions">
          {blocked && runningOnDog && (
            <div role="status">
              <p className="sheet-text" style={{ margin: 0 }}>{alreadyRunning(runningOnDog)}</p>
              {runningOnDog.handler_id === me.id && !runningHere && (
                <Link to={`/dog/${dog.id}/timer/${runningOnDog.odour_id}`} className="btn-text" style={{ padding: 0 }}>
                  {`Open the ${odourById(odours, runningOnDog.odour_id)?.name ?? 'running'} timer`}
                </Link>
              )}
            </div>
          )}
          {error && <p role="alert" className="error" style={{ margin: 0 }}>{error}</p>}
          {addedS !== null && !runningHere && (
            <p role="status" className="num" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {`+${Math.floor(addedS / 60)} min · now ${formatMinutesOfTarget(total)}`}
            </p>
          )}

          {canStop ? (
            <button type="button" className="btn btn-primary btn-start" onClick={stop} disabled={busy}>Stop</button>
          ) : (
            <button type="button" className="btn btn-primary btn-start" onClick={start} disabled={busy || blocked}>Start</button>
          )}
          <button type="button" className="btn btn-second" onClick={() => setManualOpen(true)}>
            Add a session I forgot to time
          </button>
        </div>
      </main>
      <ManualEntrySheet open={manualOpen} onClose={() => setManualOpen(false)}
        dogId={dog.id} odourId={odour.id} onCrossed={celebrateNow} />
      {celebrate && <Celebration dog={dog.name} odour={odour.name} onDone={dismissCelebration} />}
    </div>
  );
}
