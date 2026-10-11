import { useState, type FormEvent } from 'react';
import { db } from '../../data/db';
import { addDog, editDog, moveDog } from '../../data/repo';
import { BREEDS, PURPOSES } from '../../domain/breeds';
import type { BreedId, Dog, Purpose, Team } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { BreedPortrait } from '../components/BreedPortrait';
import { PillToggle } from '../components/PillToggle';
import { Sheet } from '../components/Sheet';

interface DogSheetProps {
  open: boolean;
  onClose: () => void;
  /** The active teams (for the team select when editing). */
  teams: readonly Team[];
  /** Adding: the team the dog goes into. */
  teamId?: string;
  /** Editing: the dog. Without it the sheet adds a dog. */
  dog?: Dog;
}

/**
 * Add a dog to a team, or edit one (spec §13.2). Name, breed and purpose are all required and none is
 * pre-chosen when adding. Editing can also move the dog to another active team. Trainers only: the
 * screens that open it never offer it to a handler, and the actions refuse a handler anyway.
 */
export function DogSheet({ open, onClose, teams, teamId, dog }: DogSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={dog ? 'Edit dog' : 'Add dog'}>
      {/* Mounted only while open, so the fields start fresh every time. */}
      <DogForm onClose={onClose} teams={teams} teamId={teamId} dog={dog} />
    </Sheet>
  );
}

function DogForm({ onClose, teams, teamId, dog }: Omit<DogSheetProps, 'open'>) {
  const me = useMe();
  const [name, setName] = useState(dog?.name ?? '');
  const [breed, setBreed] = useState<BreedId | ''>(dog?.breed ?? '');
  const [choices, setChoices] = useState(0); // the drawing plays on each choice, not when the sheet opens
  const [purpose, setPurpose] = useState<Purpose | ''>(dog?.purpose ?? '');
  const [team, setTeam] = useState(dog?.team_id ?? teamId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = name.trim() !== '' && breed !== '' && purpose !== '' && team !== '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!me || busy || !ready) return;
    setBusy(true);
    setError('');
    try {
      const ctx = { db, me };
      if (dog) {
        await editDog(ctx, dog.id, {
          ...(name.trim() !== dog.name && { name }),
          ...(breed !== dog.breed && { breed: breed as BreedId }),
          ...(purpose !== dog.purpose && { purpose: purpose as Purpose }),
        });
        if (team !== dog.team_id) await moveDog(ctx, dog.id, team);
      } else {
        await addDog(ctx, name, team, breed as BreedId, purpose as Purpose);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the dog.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="label" htmlFor="dog-name">Dog name</label>
      <input id="dog-name" className="field" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />

      <p className="label" id="breed-label">Breed</p>
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 192, marginBottom: 8 }}>
        {breed ? (
          <BreedPortrait key={choices} breed={breed} size="lg" play={choices > 0} />
        ) : (
          <p className="italic soft" style={{ margin: 0 }}>Choose a breed</p>
        )}
      </div>
      <div role="group" aria-labelledby="breed-label" className="choices" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {BREEDS.map((b) => (
          <button key={b.id} type="button" className="choice" aria-pressed={b.id === breed}
            onClick={() => { setBreed(b.id); setChoices((n) => n + 1); }}>
            {b.label}
          </button>
        ))}
      </div>

      <p className="label">Purpose</p>
      <PillToggle label="Purpose" variant="choice" value={purpose} onChange={(p) => setPurpose(p as Purpose)}
        options={PURPOSES.map((p) => ({ value: p.id, label: p.label }))} />

      {dog && (
        <>
          <label className="label" htmlFor="dog-team">Team</label>
          <select id="dog-team" className="field" value={team} onChange={(e) => setTeam(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </>
      )}

      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy} style={{ marginTop: 20 }}>
        {dog ? 'Save dog' : 'Add dog'}
      </button>
    </form>
  );
}
