import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../data/db';
import { syncStatus, takeNotices } from '../../data/sync';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useRunningItems, useRunningTeamIds } from '../../hooks/useRunningItems';
import { useUnitData } from '../../hooks/useUnitData';
import { Card } from '../components/Card';
import { DogDrawing } from '../components/DogDrawing';
import { HeaderBar } from '../components/HeaderBar';
import { RunningBanner } from '../components/RunningBanner';
import { SyncBadge } from '../components/SyncBadge';
import { NewTeamSheet } from './NewTeamSheet';
import { linkButton, plural } from '../shared';

const NO_SYNC = { pending: 0, rejected: 0, stale: false };

/** Home: the unit's active teams. A trainer also gets the way to Members, Odours and Archived. */
export function TeamsScreen() {
  const me = useMe();
  const { dogs, archivedDogs, teams, archivedTeams, odours, catalogue, members, sessions, corrections, loading } = useUnitData();
  const navigate = useNavigate();
  const sync = useLiveQuery(() => syncStatus(db), [], NO_SYNC);
  const [notices, setNotices] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Reading clears them, so keep what we get (and never overwrite it with the empty second read).
  useEffect(() => {
    void takeNotices(db).then((n) => { if (n.length) setNotices((prev) => [...prev, ...n]); });
  }, []);

  const running = useRunningItems(dogs, members, odours, sessions, corrections);
  const runningTeams = useRunningTeamIds(dogs, sessions, corrections);
  useNow(running.length > 0 ? 1000 : null);

  if (!me) return null;
  const isTrainer = me.role === 'trainer';
  const archivedCount = archivedTeams.length + archivedDogs.length;

  return (
    <div className="screen">
      <HeaderBar title="Teams" />
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
            onClick={() => setCreating(true)}>
            + New team
          </button>
        )}
        {isTrainer && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <Link to="/members" className="btn" style={{ flex: 1 }}>Members</Link>
            <Link to="/odours" className="btn" style={{ flex: 1 }}>Odours</Link>
          </div>
        )}

        {!loading && teams.length === 0 && (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '24px 0', textAlign: 'center' }}>
            <DogDrawing />
            <h2 style={{ fontSize: 22 }}>No teams yet</h2>
            {isTrainer && <p style={{ margin: 0 }}>Create your first team</p>}
          </div>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {teams.map((t) => {
            const count = dogs.filter((d) => d.team_id === t.id).length;
            return (
              <li key={t.id}>
                <Card onClick={() => navigate(`/team/${t.id}`)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 26, fontWeight: 800, overflowWrap: 'anywhere' }}>{t.name}</span>
                      <span className="num" style={{ display: 'block' }}>{plural(count, 'dog')}</span>
                    </span>
                    {runningTeams.has(t.id) && (
                      <span role="img" aria-label="Timer running" style={{
                        width: 14, height: 14, flex: 'none', borderRadius: '50%', background: 'var(--stamp)',
                      }} />
                    )}
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>

        {isTrainer && archivedCount > 0 && (
          <Link to="/archived" style={{ ...linkButton, marginTop: 16, textDecoration: 'underline' }}>
            {`Archived (${archivedCount})`}
          </Link>
        )}
      </main>

      {isTrainer && <NewTeamSheet open={creating} onClose={() => setCreating(false)} catalogue={catalogue} />}
    </div>
  );
}
