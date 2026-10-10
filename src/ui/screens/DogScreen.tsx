import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../data/db';
import { archiveDog } from '../../data/repo';
import { breedLabel, purposeLabel } from '../../domain/breeds';
import { exportDogReport } from '../../export/run';
import { formatMinutesOfTarget } from '../../domain/format';
import { NOT_IN_CURRENT_LIST, isInTeamList, odourById, teamOdourGroups } from '../../domain/odours';
import { IMPRINT_TARGET_S, isImprinted, isRunning, odourTotal } from '../../domain/totals';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { BreedPortrait } from '../components/BreedPortrait';
import { ExportButton } from '../components/ExportButton';
import { HeaderBar } from '../components/HeaderBar';
import { ImprintedStamp } from '../components/ImprintedStamp';
import { PillToggle } from '../components/PillToggle';
import { ProgressBar } from '../components/ProgressBar';
import { Sheet } from '../components/Sheet';
import { DogSheet } from './DogSheet';

export function DogScreen() {
  const { dogId } = useParams();
  const me = useMe();
  const { dogs, teams, sessions, corrections, odours, catalogue, loading } = useUnitData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  // Where to go once the dog is gone from the list: its team, if we are the ones archiving it.
  const [leavingTo, setLeavingTo] = useState<string | null>(null);

  const dog = dogs.find((d) => d.id === dogId);
  const runningHere = useMemo(
    () => sessions.find((s) => s.dog_id === dogId && isRunning(s, corrections)),
    [sessions, corrections, dogId],
  );
  // Only tick while a timer is running on this dog; otherwise nothing on screen can change with time.
  const now = useNow(runningHere ? 1000 : null);

  if (loading || !me) return null;
  if (!dog) return <Navigate to={leavingTo ?? '/'} replace />;

  // The odours of the dog's team, in category tabs. The tab lives in the URL (?cat=<category id>); without a
  // usable one it is the running odour's category, else the first.
  const groups = teamOdourGroups(dog.team_id, catalogue);
  const urlCat = params.get('cat');
  const runningOdour = runningHere && odourById(odours, runningHere.odour_id);
  const runningCat = runningOdour && runningOdour.category_id;
  const shown = groups.find((g) => g.category.id === urlCat)
    ?? groups.find((g) => g.category.id === runningCat)
    ?? groups[0];
  const isTrainer = me.role === 'trainer';
  const trainerCtx = { db, me };

  function askToArchive() {
    setError('');
    if (runningHere) { setBlocked(true); return; }
    setConfirming(true);
  }

  async function archive() {
    setLeavingTo(`/team/${dog!.team_id}`); // the list updates as soon as the change is saved, before this resolves
    try {
      await archiveDog(trainerCtx, dog!.id);
    } catch (err) {
      setLeavingTo(null);
      setError(err instanceof Error ? err.message : 'Could not archive the dog.');
    }
  }

  return (
    <div className="screen">
      <HeaderBar title={dog.name} onBack={() => navigate(`/team/${dog.team_id}`)}
        right={isTrainer ? (
          <Link to={`/dog/${dog.id}/log`}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--tap)', padding: '0 12px', textDecoration: 'none' }}>
            Log
          </Link>
        ) : undefined} />
      <main className="pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <BreedPortrait breed={dog.breed} size="md" play idle={!!runningHere} />
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{`${breedLabel(dog.breed)} · ${purposeLabel(dog.purpose)}`}</p>
        </div>
        {groups.length > 0 && shown && (
          <PillToggle value={shown.category.id} options={groups.map((g) => ({ value: g.category.id, label: g.category.name }))}
            onChange={(cat) => setParams({ cat }, { replace: true })} />
        )}
        {groups.length === 0 && <p style={{ textAlign: 'center', fontWeight: 800 }}>No odours selected for this team</p>}

        {runningOdour && !isInTeamList(dog.team_id, runningOdour.id, catalogue) && (
          <Link to={`/dog/${dog.id}/timer/${runningOdour.id}`} style={{
            display: 'block', marginTop: 16, padding: '10px 12px', textDecoration: 'none', fontWeight: 800,
            border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--mustard)',
          }}>
            {`Running: ${runningOdour.name} ${NOT_IN_CURRENT_LIST}`}
          </Link>
        )}

        <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {(shown?.odours ?? []).map((odour) => {
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
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 800 }}>
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
            <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={askToArchive}>Archive</button>
          </div>
        )}
        {isTrainer && (
          <div style={{ marginTop: 12 }}>
            <ExportButton label="Progress report (PDF)" run={() => exportDogReport(db, me, dog.id)} />
          </div>
        )}
        {isTrainer && blocked && runningHere && (
          <p role="alert" className="error">Stop the running timer before archiving</p>
        )}
      </main>

      {isTrainer && <DogSheet open={editing} onClose={() => setEditing(false)} teams={teams} dog={dog} />}

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
