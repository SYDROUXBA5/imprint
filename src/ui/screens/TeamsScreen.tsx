import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { switchName } from '../../data/account';
import { db } from '../../data/db';
import { syncStatus, takeNotices } from '../../data/sync';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useRunningItems, useRunningTeamIds } from '../../hooks/useRunningItems';
import { useUnitData } from '../../hooks/useUnitData';
import { Capacity } from '../components/Capacity';
import { ForwardChevron } from '../components/icons';
import { Masthead } from '../components/Masthead';
import { RunningBanner } from '../components/RunningBanner';
import { Sheet } from '../components/Sheet';
import { SyncBadge } from '../components/SyncBadge';
import { NewTeamSheet } from './NewTeamSheet';
import { plural } from '../shared';

const NO_SYNC = { pending: 0, rejected: 0, stale: false };

/** Home: the unit's active teams. A trainer also gets the way to Members, Odours and Archived. */
export function TeamsScreen() {
  const me = useMe();
  const { dogs, archivedDogs, teams, archivedTeams, odours, catalogue, members, sessions, corrections, loading } = useUnitData();
  const navigate = useNavigate();
  const sync = useLiveQuery(() => syncStatus(db), [], NO_SYNC);
  const [notices, setNotices] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

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

  // Work recorded under this name can only be sent while the phone is still signed in under it.
  const switchOrAsk = () => (sync.pending > 0 ? setConfirmSwitch(true) : void switchName());

  return (
    <div className="screen">
      <Masthead />

      <button type="button" className="who" style={{ minHeight: 46 }} aria-label={`${me.name} · Switch`} onClick={switchOrAsk}>
        <span className="who-name" data-role={`, ${me.role}`}>{me.name}</span>
        <span className="sr-only"> &middot; </span>
        <span className="who-switch">Switch</span>
      </button>

      <RunningBanner items={running} />

      {notices.map((n) => (
        <div key={n} role="status" className="note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{n}</span>
          <button type="button" className="btn btn-sm" onClick={() => setNotices((prev) => prev.filter((x) => x !== n))}>
            Dismiss
          </button>
        </div>
      ))}

      <main className="page">
        <h1 className="caps" style={{ margin: '20px 0 0', letterSpacing: '0.14em' }}>Teams</h1>

        {!loading && teams.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <h2 style={{ fontSize: 24 }}>No teams yet</h2>
            {isTrainer && <p className="italic">Create your first team</p>}
          </div>
        )}

        <ul className="rows">
          {teams.map((t) => {
            const count = dogs.filter((d) => d.team_id === t.id).length;
            return (
              <li key={t.id}>
                <button type="button" className="row-btn" style={{ minHeight: 60 }} onClick={() => navigate(`/team/${t.id}`)}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 30, fontWeight: 600, lineHeight: 1.05, overflowWrap: 'anywhere' }}>{t.name}</span>
                    <span style={{ display: 'block', marginTop: 6 }}><Capacity count={count} planned={t.planned_dogs} /></span>
                  </span>
                  {runningTeams.has(t.id) && <span role="img" aria-label="Timer running" className="tag">Live</span>}
                  <ForwardChevron />
                </button>
              </li>
            );
          })}
        </ul>

        {isTrainer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-primary" aria-label="+ New team" onClick={() => setCreating(true)}>
              New team
            </button>
            <div className="btn-row" style={{ display: 'grid', gridTemplateColumns: `repeat(${archivedCount > 0 ? 3 : 2}, minmax(0, 1fr))`, gap: 8 }}>
              <Link to="/members" className="btn">Members</Link>
              <Link to="/odours" className="btn">Odours</Link>
              {archivedCount > 0 && (
                <Link to="/archived" className="btn" aria-label={`Archived (${archivedCount})`}>{`Archived ${archivedCount}`}</Link>
              )}
            </div>
          </div>
        )}

        <SyncBadge {...sync} />
      </main>

      {isTrainer && <NewTeamSheet open={creating} onClose={() => setCreating(false)} catalogue={catalogue} />}

      <Sheet open={confirmSwitch} onClose={() => setConfirmSwitch(false)} title="Unsent work">
        <p className="sheet-text">
          {`${me.name} still has ${plural(sync.pending, 'unsent item')} on this phone. Wait for signal and let it send before switching: once the phone is signed in under another name it cannot be sent.`}
        </p>
        <div className="sheet-actions" style={{ flexDirection: 'column' }}>
          <button type="button" className="btn btn-primary" onClick={() => setConfirmSwitch(false)}>
            {`Stay as ${me.name}`}
          </button>
          <button type="button" className="btn" onClick={() => { setConfirmSwitch(false); void switchName(); }}>
            Switch anyway
          </button>
        </div>
      </Sheet>
    </div>
  );
}
