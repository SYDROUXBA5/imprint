import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { breedLabel, purposeLabel } from '../../domain/breeds';
import { progressLine } from '../../domain/progress';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useRunningItems } from '../../hooks/useRunningItems';
import { useUnitData } from '../../hooks/useUnitData';
import { BreedPortrait } from '../components/BreedPortrait';
import { Card } from '../components/Card';
import { DogDrawing } from '../components/DogDrawing';
import { HeaderBar } from '../components/HeaderBar';
import { RunningBanner } from '../components/RunningBanner';
import { DogSheet } from './DogSheet';

/** One team's dogs. A trainer can add a dog here; a handler can only pick one. */
export function TeamDogsScreen() {
  const { teamId } = useParams();
  const me = useMe();
  const { dogs, teams, odours, members, sessions, corrections, loading } = useUnitData();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  const team = teams.find((t) => t.id === teamId);
  const teamDogs = dogs.filter((d) => d.team_id === teamId);
  const running = useRunningItems(teamDogs, members, odours, sessions, corrections);
  const now = useNow(running.length > 0 ? 1000 : null);

  if (loading || !me) return null;
  if (!team) return <Navigate to="/" replace />;
  const isTrainer = me.role === 'trainer';

  return (
    <div className="screen">
      <HeaderBar title={team.name} onBack={() => navigate('/')} />
      <RunningBanner items={running} />
      <main className="pad">
        {isTrainer && (
          <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 12 }}
            onClick={() => setAdding(true)}>
            + Add dog
          </button>
        )}

        {teamDogs.length === 0 && (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '24px 0', textAlign: 'center' }}>
            <DogDrawing />
            <h2 style={{ fontSize: 22 }}>No dogs yet</h2>
            {isTrainer && <p style={{ margin: 0 }}>Add your first dog</p>}
          </div>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {teamDogs.map((d) => {
            const line = progressLine(d.id, sessions, corrections, odours, now);
            return (
              <li key={d.id}>
                <Card onClick={() => navigate(`/dog/${d.id}`)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <BreedPortrait breed={d.breed} size="sm" play={false} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 24, fontWeight: 800, overflowWrap: 'anywhere' }}>{d.name}</span>
                      <span className="muted" style={{ display: 'block', fontWeight: 700 }}>
                        {`${breedLabel(d.breed)} · ${purposeLabel(d.purpose)}`}
                      </span>
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
      </main>

      {isTrainer && <DogSheet open={adding} onClose={() => setAdding(false)} teams={teams} teamId={team.id} />}
    </div>
  );
}
