import { useState, type FormEvent } from 'react';
import { db } from '../../data/db';
import { archiveTeam, renameTeam, setTeamOdours, setTeamPlannedDogs } from '../../data/teams';
import { selectedOdourIds } from '../../domain/odours';
import { exportTeamCsv, exportTeamReport } from '../../export/run';
import type { Catalogue, Team } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { usePlannedDogsInput } from '../../hooks/usePlannedDogsInput';
import { ExportButton, UnsyncedNote } from '../components/ExportButton';
import { OdourPicker } from '../components/OdourPicker';
import { PlannedDogsField } from '../components/PlannedDogsField';
import { Sheet } from '../components/Sheet';
import { plural, stickyFooter } from '../shared';

interface TeamSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  team: Team;
  catalogue: Catalogue;
  /** True while a timer runs on any dog of the team: the team cannot be archived then. */
  timerRunning: boolean;
  /** Where the sheet opens: the settings (default), or straight on the archive question. */
  startAt?: 'main' | 'archive';
}

type View = 'main' | 'odours' | 'archive';
const TITLES: Record<View, string> = { main: 'Team settings', odours: 'Team odours', archive: 'Archive team' };

/**
 * A team's settings (spec §13.1): rename, how many dogs it will hold, which odours it trains on, the team reports (§13.6), archive (after
 * asking). Trainers only; the report buttons also check the role themselves.
 * One sheet with three views, so there is never a sheet on top of a sheet.
 */
export function TeamSettingsSheet({ open, onClose, team, catalogue, timerRunning, startAt = 'main' }: TeamSettingsSheetProps) {
  // null = wherever it was asked to open: the settings, or straight on the archive question.
  const [moved, setView] = useState<View | null>(null);
  const view = moved ?? startAt;
  const close = () => { setView(null); onClose(); };
  return (
    <Sheet open={open} onClose={close} title={TITLES[view]}>
      {/* Mounted only while open, so the fields start fresh every time. */}
      <Body team={team} catalogue={catalogue} timerRunning={timerRunning} view={view} setView={setView} onClose={close}
        archiveOnly={startAt === 'archive'} />
    </Sheet>
  );
}

interface BodyProps {
  team: Team;
  catalogue: Catalogue;
  timerRunning: boolean;
  view: View;
  setView: (v: View) => void;
  onClose: () => void;
  /** Opened straight on the archive question (the team screen's own button): Cancel then closes the sheet. */
  archiveOnly: boolean;
}

function Body({ team, catalogue, timerRunning, view, setView, onClose, archiveOnly }: BodyProps) {
  const me = useMe();
  const { categories, odours, teamOdours } = catalogue;
  const [name, setName] = useState(team.name);
  const savedDogs = team.planned_dogs == null ? '' : String(team.planned_dogs); // a team from before the number was asked for has none
  const dogs = usePlannedDogsInput(savedDogs);
  // What is saved, until the trainer changes a tick; then their draft.
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const picked = draft ?? selectedOdourIds(teamOdours, team.id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const offered = new Set(odours.filter((o) => o.archived_at === null).map((o) => o.id));
  const savedCount = [...selectedOdourIds(teamOdours, team.id)].filter((id) => offered.has(id)).length;
  const chosen = [...picked].filter((id) => offered.has(id));

  /** Run a change; show why it failed; true when it went through. */
  async function run(change: () => Promise<void>, failure: string): Promise<boolean> {
    if (!me || busy) return false;
    setBusy(true);
    setError('');
    try {
      await change();
      setBusy(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
      setBusy(false);
      return false;
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (await run(() => renameTeam({ db, me: me! }, team.id, name), 'Could not rename the team.')) onClose();
  }

  async function saveDogs(e: FormEvent) {
    e.preventDefault();
    if (dogs.value === null) { dogs.complain(); return; }
    const planned = dogs.value;
    if (await run(() => setTeamPlannedDogs({ db, me: me! }, team.id, planned), 'Could not save the number of dogs.')) onClose();
  }

  async function saveOdours() {
    const ok = await run(() => setTeamOdours({ db, me: me! }, team.id, chosen), 'Could not save the odours.');
    if (ok) setView('main');
  }

  function askToArchive() {
    setError('');
    if (timerRunning) { setError('Stop the running timer before archiving'); return; }
    setView('archive');
  }

  // The team leaves the active list as soon as this is saved, and the screen then goes home by itself.
  const archive = () => run(() => archiveTeam({ db, me: me! }, team.id), 'Could not archive the team.');

  if (view === 'odours') {
    return (
      <div>
        <div style={{ marginTop: 12 }}>
          <OdourPicker categories={categories} odours={odours} selected={picked} onChange={setDraft} />
        </div>
        {chosen.length === 0 && <p className="hint">Pick at least one odour</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div style={{ ...stickyFooter, display: 'grid', gap: 8 }}>
          <button type="button" className="btn btn-primary btn-block"
            disabled={chosen.length === 0 || busy} onClick={saveOdours}>
            Save odours
          </button>
          <button type="button" className="btn btn-block"
            onClick={() => { setError(''); setDraft(null); setView('main'); }}>
            Back to settings
          </button>
        </div>
      </div>
    );
  }

  if (view === 'archive') {
    return (
      <div>
        <p className="sheet-text">
          {`Archive ${team.name}? It and its dogs disappear for everyone; you can restore it from Archived.`}
        </p>
        {timerRunning && <p role="alert" className="error">Stop the running timer before archiving</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => { setError(''); if (archiveOnly) onClose(); else setView('main'); }}>Cancel</button>
          <button type="button" className="btn btn-primary btn-danger" disabled={busy || timerRunning} onClick={archive}>
            {`Archive ${team.name}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={saveName}>
        <label className="label" htmlFor="team-settings-name">Team name</label>
        <input id="team-settings-name" className="field" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-block" disabled={busy || !name.trim() || name.trim() === team.name}
          style={{ marginTop: 12 }}>
          Save name
        </button>
      </form>

      {/* noValidate: the field says what is wrong in its own words, not in the browser's bubble. */}
      <form onSubmit={saveDogs} noValidate>
        <PlannedDogsField id="team-settings-dogs" text={dogs.text} onChange={dogs.setText} showError={dogs.showError} inputRef={dogs.input} />
        <button type="submit" className="btn btn-block" disabled={busy || dogs.text.trim() === savedDogs}
          style={{ marginTop: 12 }}>
          Save number of dogs
        </button>
      </form>

      <p className="label">Odours</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{`${plural(savedCount, 'odour')} selected`}</span>
        <button type="button" className="btn" onClick={() => { setError(''); setView('odours'); }}>Choose odours</button>
      </div>

      {me?.role === 'trainer' && (
        <>
          <p className="label">Reports</p>
          <UnsyncedNote />
          <div style={{ display: 'grid', gap: 8 }}>
            <ExportButton note={false} label="Team report (PDF)" run={() => exportTeamReport(db, me, team.id)} />
            <ExportButton note={false} label="Team sessions (CSV)" run={() => exportTeamCsv(db, team.id)} />
          </div>
        </>
      )}

      {error && <p role="alert" className="error">{error}</p>}
      <button type="button" className="btn btn-block btn-danger" onClick={askToArchive} style={{ marginTop: 28 }}>
        Archive team
      </button>
    </div>
  );
}
