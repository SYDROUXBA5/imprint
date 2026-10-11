import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../data/db';
import { archiveDog } from '../../data/repo';
import { breedLabel, purposeLabel } from '../../domain/breeds';
import { exportDogReport } from '../../export/run';
import { formatTyped } from '../../domain/format';
import { NOT_IN_CURRENT_LIST, isInTeamList, odourById, teamOdourGroups } from '../../domain/odours';
import { IMPRINT_TARGET_S, isImprinted, isRunning, liveElapsed, odourTotal } from '../../domain/totals';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { BreedPortrait } from '../components/BreedPortrait';
import { ExportButton, UnsyncedNote } from '../components/ExportButton';
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

  const team = teams.find((t) => t.id === dog.team_id);

  return (
    <div className="screen">
      <HeaderBar title={dog.name} onBack={() => navigate(`/team/${dog.team_id}`)}
        right={isTrainer ? <Link to={`/dog/${dog.id}/log`} className="btn-text">Log</Link> : undefined} />
      <main className="page">
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
          <BreedPortrait breed={dog.breed} size="md" play idle={!!runningHere} />
        </div>
        <div className="band" style={{ flexWrap: 'wrap', alignItems: 'baseline', padding: '7px 0', gap: '2px 12px' }}>
          <span className="italic" style={{ fontSize: 19 }}>{breedLabel(dog.breed)}</span>
          <span className="band-end num soft" style={{ fontSize: 14 }}>
            {[purposeLabel(dog.purpose).toLowerCase(), team?.name].filter(Boolean).join(' · ')}
          </span>
        </div>
        {groups.length > 0 && shown && (
          <PillToggle value={shown.category.id} options={groups.map((g) => ({ value: g.category.id, label: g.category.name }))}
            onChange={(cat) => setParams({ cat }, { replace: true })} />
        )}
        {groups.length === 0 && <p className="italic" style={{ textAlign: 'center' }}>No odours selected for this team</p>}

        {runningOdour && !isInTeamList(dog.team_id, runningOdour.id, catalogue) && (
          <Link to={`/dog/${dog.id}/timer/${runningOdour.id}`} className="running-box" style={{ textDecoration: 'none' }}>
            <span className="running-box-main">
              <span className="running-line" style={{ display: 'block' }}>{`Running: ${runningOdour.name} ${NOT_IN_CURRENT_LIST}`}</span>
            </span>
          </Link>
        )}

        <ul className="rows">
          {(shown?.odours ?? []).map((odour) => {
            const total = odourTotal(sessions, corrections, dog.id, odour.id, now);
            const imprinted = isImprinted(total);
            const runningThis = runningHere?.odour_id === odour.id;
            const liveS = runningThis && runningHere ? liveElapsed(runningHere, corrections, now) : 0;
            return (
              <li key={odour.id}>
                <Link to={`/dog/${dog.id}/timer/${odour.id}`} className="odour-link"
                  aria-label={imprinted
                    ? `${odour.name}, imprinted`
                    : `${odour.name}, ${Math.floor(total / 60)} of ${IMPRINT_TARGET_S / 60} minutes`}>
                  <span className="odour-top">
                    <span>
                      <span data-odour-name className="odour-name">{odour.name}</span>
                      {runningThis && <>{' '}<span data-testid="running-tag" className="tag">Running</span></>}
                    </span>
                    {imprinted ? <ImprintedStamp size="row" /> : total === 0 && !runningThis ? (
                      <span className="odour-time soft">not started</span>
                    ) : (
                      <span className="odour-time">
                        <b>{formatTyped(total)}</b><span className="soft">{` / ${formatTyped(IMPRINT_TARGET_S)}`}</span>
                      </span>
                    )}
                  </span>
                  <ProgressBar valueS={total} liveS={liveS} label={odour.name} />
                </Link>
              </li>
            );
          })}
        </ul>

        {isTrainer && (
          <div style={{ marginTop: 'auto', paddingTop: 20 }}>
            <UnsyncedNote />
            <div className="btn-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="btn" onClick={askToArchive}>Archive</button>
              <ExportButton note={false} block={false} label="Progress report (PDF)" shortLabel="Report PDF"
                run={() => exportDogReport(db, me, dog.id)} />
            </div>
          </div>
        )}
        {isTrainer && blocked && runningHere && (
          <p role="alert" className="error">Stop the running timer before archiving</p>
        )}
      </main>

      {isTrainer && <DogSheet open={editing} onClose={() => setEditing(false)} teams={teams} dog={dog} />}

      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Archive dog">
        <p className="sheet-text">
          {`Archive ${dog.name}? It disappears from the list; you can restore it from Archived.`}
        </p>
        {error && confirming && <p role="alert" className="error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          <button type="button" className="btn btn-primary btn-danger" onClick={archive}>
            {`Archive ${dog.name}`}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
