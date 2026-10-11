import { useState, type FormEvent } from 'react';
import { db } from '../../data/db';
import { createTeam } from '../../data/teams';
import type { Catalogue } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { usePlannedDogsInput } from '../../hooks/usePlannedDogsInput';
import { OdourPicker } from '../components/OdourPicker';
import { PlannedDogsField } from '../components/PlannedDogsField';
import { Sheet } from '../components/Sheet';
import { stickyFooter } from '../shared';

/**
 * Create a team: a name, the number of dogs it will hold (a plan, it adds no dogs) and the odours it trains on
 * (spec §13.1). At least one odour. Trainers only.
 */
export function NewTeamSheet({ open, onClose, catalogue }: { open: boolean; onClose: () => void; catalogue: Catalogue }) {
  return (
    <Sheet open={open} onClose={onClose} title="New team">
      {/* Mounted only while open, so the draft starts empty every time. */}
      <NewTeamForm onClose={onClose} catalogue={catalogue} />
    </Sheet>
  );
}

function NewTeamForm({ onClose, catalogue }: { onClose: () => void; catalogue: Catalogue }) {
  const me = useMe();
  const { categories, odours } = catalogue;
  const [name, setName] = useState('');
  const dogs = usePlannedDogsInput();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const offered = new Set(odours.filter((o) => o.archived_at === null).map((o) => o.id));
  const chosen = [...selected].filter((id) => offered.has(id));
  const ready = name.trim() !== '' && chosen.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!me || busy || !ready) return;
    if (dogs.value === null) { dogs.complain(); return; }
    setBusy(true);
    setError('');
    try {
      await createTeam({ db, me }, name, chosen, dogs.value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the team.');
      setBusy(false);
    }
  }

  return (
    // noValidate: the field says what is wrong in its own words, not in the browser's bubble.
    <form onSubmit={submit} noValidate>
      <label className="label" htmlFor="team-name">Team name</label>
      <input id="team-name" className="field" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />

      <PlannedDogsField id="team-dogs" text={dogs.text} onChange={dogs.setText} showError={dogs.showError} inputRef={dogs.input} />

      <p className="label">Odours this team trains on</p>
      <OdourPicker categories={categories} odours={odours} selected={selected} onChange={setSelected} />
      {chosen.length === 0 && <p className="muted" style={{ margin: '0 0 4px', fontWeight: 700 }}>Pick at least one odour</p>}

      {error && <p role="alert" className="error">{error}</p>}
      <div style={stickyFooter}>
        <button type="submit" className="btn btn-primary" disabled={!ready || busy} style={{ width: '100%' }}>
          Create team
        </button>
      </div>
    </form>
  );
}
