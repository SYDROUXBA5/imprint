import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { breedLabel, purposeLabel } from '../../domain/breeds';
import { formatTyped, formatTypedClock } from '../../domain/format';
import { odourName, selectedOdourIds } from '../../domain/odours';
import { trainedOdours } from '../../domain/progress';
import { isImprinted, isRunning } from '../../domain/totals';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { BreedPortrait } from '../components/BreedPortrait';
import { Capacity } from '../components/Capacity';
import { DogDrawing } from '../components/DogDrawing';
import { HeaderBar } from '../components/HeaderBar';
import { freePlacesText, plural } from '../shared';
import { DogSheet } from './DogSheet';
import { TeamSettingsSheet } from './TeamSettingsSheet';

/** One team's dogs. A trainer can add a dog here; a handler can only pick one. */
export function TeamDogsScreen() {
  const { teamId } = useParams();
  const me = useMe();
  const { dogs, teams, odours, catalogue, sessions, corrections, loading } = useUnitData();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  // The settings sheet: closed, open on the settings, or open straight on the archive question.
  const [settings, setSettings] = useState<'main' | 'archive' | null>(null);

  const team = teams.find((t) => t.id === teamId);
  const teamDogs = dogs.filter((d) => d.team_id === teamId);
  const running = useMemo(
    () => sessions.filter((s) => teamDogs.some((d) => d.id === s.dog_id) && isRunning(s, corrections)),
    [sessions, corrections, teamDogs],
  );
  const now = useNow(running.length > 0 ? 1000 : null);
  // The timer running on each dog of the team (a dog has at most one), for the "Running 07:41 · C4/RDX" tag.
  const runningByDog = useMemo(() => {
    const byDog = new Map<string, { startedAt: string; odour: string }>();
    for (const s of running) byDog.set(s.dog_id, { startedAt: s.started_at!, odour: odourName(odours, s.odour_id) });
    return byDog;
  }, [running, odours]);
  const timerRunning = running.length > 0;

  if (loading || !me) return null;
  if (!team) return <Navigate to="/" replace />;
  const isTrainer = me.role === 'trainer';
  const offeredOdours = new Set(catalogue.odours.filter((o) => o.archived_at === null).map((o) => o.id));
  const teamOdourCount = [...selectedOdourIds(catalogue.teamOdours, team.id)].filter((id) => offeredOdours.has(id)).length;
  const freePlaces = freePlacesText(teamDogs.length, team.planned_dogs);

  return (
    <div className="screen">
      <HeaderBar title={team.name} onBack={() => navigate('/')} right={isTrainer ? (
        <button type="button" className="btn-text" onClick={() => setSettings('main')}>Settings</button>
      ) : undefined} />

      <div className="band" style={{ marginTop: 8 }}>
        <Capacity count={teamDogs.length} planned={team.planned_dogs} />
        <span className="band-end nowrap num soft" style={{ fontSize: 14 }}>{plural(teamOdourCount, 'odour')}</span>
      </div>

      <main className="page">
        {isTrainer && (
          <button type="button" className="btn btn-primary" aria-label="+ Add dog" style={{ marginTop: 14 }}
            onClick={() => setAdding(true)}>
            Add dog
          </button>
        )}

        {teamDogs.length === 0 && (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '24px 0', textAlign: 'center' }}>
            <DogDrawing />
            <h2 style={{ fontSize: 24 }}>No dogs yet</h2>
            {isTrainer && <p className="italic" style={{ margin: 0 }}>Add your first dog</p>}
          </div>
        )}

        <ul className="rows" style={{ marginTop: 4 }}>
          {teamDogs.map((d) => {
            const trained = trainedOdours(d.id, sessions, corrections, odours, now);
            const imprinted = trained.filter((o) => isImprinted(o.totalS)).length;
            const latest = trained.find((o) => !isImprinted(o.totalS));
            const live = runningByDog.get(d.id);
            return (
              <li key={d.id}>
                <button type="button" className="row-btn dog-row" onClick={() => navigate(`/dog/${d.id}`)}>
                  <BreedPortrait breed={d.breed} size="sm" play={false} />
                  <span className="dog-row-text">
                    <span className="dog-name">{d.name}</span>
                    <span className="dog-breed">{breedLabel(d.breed)}</span>
                    <span className="dog-purpose">{purposeLabel(d.purpose).toLowerCase()}</span>
                    <span className="dog-status">
                      {imprinted > 0 && <span className="stamp stamp-small">{`${imprinted} imprinted`}</span>}
                      {live ? (
                        <span className="tag tag-run">{`Running ${formatTypedClock((now - Date.parse(live.startedAt)) / 1000)} · ${live.odour}`}</span>
                      ) : latest ? (
                        <span>{`${latest.name} ${formatTyped(latest.totalS)}`}</span>
                      ) : imprinted === 0 ? (
                        <span className="soft" style={{ fontWeight: 400 }}>Nothing logged yet</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div style={{ marginTop: 'auto', display: 'grid', gap: 12, paddingTop: 16 }}>
          {isTrainer && (
            <button type="button" className="btn btn-block" onClick={() => setSettings('archive')}>Archive team</button>
          )}
          {freePlaces && <p className="sync-line" style={{ margin: 0 }}>{freePlaces}</p>}
        </div>
      </main>

      {isTrainer && <DogSheet open={adding} onClose={() => setAdding(false)} teams={teams} teamId={team.id} />}
      {isTrainer && (
        <TeamSettingsSheet open={settings !== null} startAt={settings ?? 'main'} onClose={() => setSettings(null)}
          team={team} catalogue={catalogue} timerRunning={timerRunning} />
      )}
    </div>
  );
}
