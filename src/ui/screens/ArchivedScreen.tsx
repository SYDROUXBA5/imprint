import { useState, type FormEvent } from 'react';
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
      <main className="page">
        {error && !deleting && <p role="alert" className="error">{error}</p>}

        <section aria-label="Archived teams" className="section" style={{ marginTop: 8 }}>
          <h2>Teams</h2>
          {archivedTeams.length === 0 && <p className="italic soft">No archived teams</p>}
          <ul className="rows">
            {archivedTeams.map((team) => (
              <li key={team.id} className="archived-row">
                <h2 style={{ fontSize: 28, overflowWrap: 'anywhere' }}>{team.name}</h2>
                <p className="hint">{`Archived ${formatDay(localDate(new Date(team.archived_at!)))}`}</p>
                <p className="hint" style={{ margin: 0 }}>{plural(teamDogIds(team.id).size, 'dog')}</p>
                <div className="archived-actions">
                  <button type="button" className="btn"
                    aria-label={`Restore ${team.name}`} onClick={() => restore(() => restoreTeam(ctx, team.id), 'Could not restore the team.')}>
                    Restore
                  </button>
                  <button type="button" className="btn btn-danger" aria-label={`Delete ${team.name} forever`}
                    disabled={!online} onClick={() => { setError(''); setDeleting({ kind: 'team', team }); }}>
                    Delete forever
                  </button>
                </div>
                {!online && <p className="hint">Needs signal.</p>}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Archived dogs" className="section">
          <h2>Dogs</h2>
          {archivedDogs.length === 0 && <p className="italic soft">No archived dogs</p>}
          <ul className="rows">
            {archivedDogs.map((dog) => (
              <li key={dog.id} className="archived-row">
                <h2 style={{ fontSize: 28, overflowWrap: 'anywhere' }}>{dog.name}</h2>
                <p className="hint">{`Archived ${formatDay(localDate(new Date(dog.archived_at!)))}`}</p>
                <p className="hint" style={{ margin: 0, overflowWrap: 'anywhere' }}>{teamName(dog.team_id)}</p>
                <div className="archived-actions">
                  <button type="button" className="btn"
                    aria-label={`Restore ${dog.name}`} onClick={() => restore(() => restoreDog(ctx, dog.id), 'Could not restore the dog.')}>
                    Restore
                  </button>
                  <button type="button" className="btn btn-danger" aria-label={`Delete ${dog.name} forever`}
                    disabled={!online} onClick={() => { setError(''); setDeleting({ kind: 'dog', dog }); }}>
                    Delete forever
                  </button>
                </div>
                {!online && <p className="hint">Needs signal.</p>}
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
        <p className="sheet-text">{message}</p>
        <label className="label" htmlFor="delete-confirm">{kind === 'team' ? 'Team name' : 'Dog name'}</label>
        <input id="delete-confirm" className="field" value={typed} autoComplete="off" autoCapitalize="off"
          autoCorrect="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        {!online && <p className="error">Needs signal.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-danger" disabled={!matches || !online || busy}
            style={{ fontSize: 18 }}>
            Delete forever
          </button>
        </div>
      </form>
    </Sheet>
  );
}
