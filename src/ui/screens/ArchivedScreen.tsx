import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteDogForever, deleteTeamForever, restoreDog } from '../../data/actions';
import { db } from '../../data/db';
import { restoreTeam } from '../../data/teams';
import { formatDay, localDate } from '../../domain/format';
import type { Dog, Team } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { useOnline } from '../../hooks/useOnline';
import { useUnitData } from '../../hooks/useUnitData';
import { HeaderBar } from '../components/HeaderBar';
import { Sheet } from '../components/Sheet';
import { plural } from '../shared';

const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 };
const card: CSSProperties = { padding: 14, border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)' };
const smallBtn: CSSProperties = { flex: 1, fontSize: 16, padding: '0 12px' };
const dangerBtn: CSSProperties = { ...smallBtn, color: 'var(--stamp)', borderColor: 'var(--stamp)' };

type Deleting = { kind: 'team'; team: Team } | { kind: 'dog'; dog: Dog };

/**
 * Archived teams and archived dogs (of teams that are not themselves archived). Trainer-only (the route
 * sends handlers home). Restore works offline; Delete forever needs signal and the exact name.
 */
export function ArchivedScreen() {
  const me = useMe();
  const { archivedDogs, archivedTeams, allDogs, teams, sessions, loading } = useUnitData();
  const online = useOnline();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [error, setError] = useState('');

  if (loading || !me) return null;
  const ctx = { db, me };
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '';
  const sessionCount = (dogIds: Set<string>) => sessions.filter((s) => dogIds.has(s.dog_id)).length;

  async function restore(what: () => Promise<void>, failure: string) {
    setError('');
    try {
      await what();
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    }
  }

  const teamDogIds = (teamId: string) => new Set(allDogs.filter((d) => d.team_id === teamId).map((d) => d.id));

  return (
    <div className="screen">
      <HeaderBar title="Archived" onBack={() => navigate('/')} />
      <main className="pad">
        {error && !deleting && <p role="alert" className="error">{error}</p>}

        <section aria-label="Archived teams">
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Teams</h2>
          {archivedTeams.length === 0 && (
            <p style={{ margin: '12px 0 24px', textAlign: 'center', fontWeight: 800 }}>No archived teams</p>
          )}
          <ul style={list}>
            {archivedTeams.map((team) => (
              <li key={team.id} style={card}>
                <h2 style={{ fontSize: 24, overflowWrap: 'anywhere' }}>{team.name}</h2>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  {`Archived ${formatDay(localDate(new Date(team.archived_at!)))}`}
                </p>
                <p className="muted" style={{ margin: 0 }}>{plural(teamDogIds(team.id).size, 'dog')}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn btn-primary" style={smallBtn}
                    aria-label={`Restore ${team.name}`} onClick={() => restore(() => restoreTeam(ctx, team.id), 'Could not restore the team.')}>
                    Restore
                  </button>
                  <button type="button" className="btn" style={dangerBtn} aria-label={`Delete ${team.name} forever`}
                    disabled={!online} onClick={() => { setError(''); setDeleting({ kind: 'team', team }); }}>
                    Delete forever
                  </button>
                </div>
                {!online && <p className="muted" style={{ margin: '8px 0 0', fontWeight: 700 }}>Needs signal.</p>}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Archived dogs" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Dogs</h2>
          {archivedDogs.length === 0 && (
            <p style={{ margin: '12px 0', textAlign: 'center', fontWeight: 800 }}>No archived dogs</p>
          )}
          <ul style={list}>
            {archivedDogs.map((dog) => (
              <li key={dog.id} style={card}>
                <h2 style={{ fontSize: 24, overflowWrap: 'anywhere' }}>{dog.name}</h2>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  {`Archived ${formatDay(localDate(new Date(dog.archived_at!)))}`}
                </p>
                <p className="muted" style={{ margin: 0, overflowWrap: 'anywhere' }}>{teamName(dog.team_id)}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn btn-primary" style={smallBtn}
                    aria-label={`Restore ${dog.name}`} onClick={() => restore(() => restoreDog(ctx, dog.id), 'Could not restore the dog.')}>
                    Restore
                  </button>
                  <button type="button" className="btn" style={dangerBtn} aria-label={`Delete ${dog.name} forever`}
                    disabled={!online} onClick={() => { setError(''); setDeleting({ kind: 'dog', dog }); }}>
                    Delete forever
                  </button>
                </div>
                {!online && <p className="muted" style={{ margin: '8px 0 0', fontWeight: 700 }}>Needs signal.</p>}
              </li>
            ))}
          </ul>
        </section>
      </main>

      {deleting?.kind === 'dog' && (
        <DeleteForeverSheet key={deleting.dog.id} kind="dog" name={deleting.dog.name} online={online}
          message={`This erases ${deleting.dog.name} and all ${plural(sessionCount(new Set([deleting.dog.id])), 'session')}. It cannot be undone. Type ${deleting.dog.name} to confirm.`}
          onClose={() => setDeleting(null)} onConfirm={() => deleteDogForever(ctx, deleting.dog.id)} />
      )}
      {deleting?.kind === 'team' && (
        <DeleteForeverSheet key={deleting.team.id} kind="team" name={deleting.team.name} online={online}
          message={`This erases team ${deleting.team.name}, its ${plural(teamDogIds(deleting.team.id).size, 'dog')} and all ${plural(sessionCount(teamDogIds(deleting.team.id)), 'session')}. It cannot be undone. Type ${deleting.team.name} to confirm.`}
          onClose={() => setDeleting(null)} onConfirm={() => deleteTeamForever(ctx, deleting.team.id)} />
      )}
    </div>
  );
}

interface DeleteForeverSheetProps {
  kind: 'dog' | 'team';
  name: string;
  message: string;
  online: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteForeverSheet({ kind, name, message, online, onClose, onConfirm }: DeleteForeverSheetProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The name must match exactly (case-sensitive), so a stray tap cannot erase a dog or a team.
  const matches = typed.trim() === name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches || !online || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not delete the ${kind}.`);
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Delete ${name} forever?`}>
      <form onSubmit={submit}>
        <p style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{message}</p>
        <label className="label" htmlFor="delete-confirm">{kind === 'team' ? 'Team name' : 'Dog name'}</label>
        <input id="delete-confirm" className="field" value={typed} autoComplete="off" autoCapitalize="off"
          autoCorrect="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        {!online && <p className="error">Needs signal.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={!matches || !online || busy}
            style={{ flex: 1, fontSize: 16, padding: '0 12px', background: 'var(--stamp)', borderColor: 'var(--stamp)', color: 'var(--paper)' }}>
            Delete forever
          </button>
        </div>
      </form>
    </Sheet>
  );
}
