import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { addName, chooseName, loadNames, markLost, type Entered, type NameChoice } from '../../data/account';
import type { Role } from '../../domain/types';
import { ForwardChevron } from '../components/icons';
import { Masthead } from '../components/Masthead';
import { friendlyLinkError } from '../linkErrors';

const LISTS: Record<Role, string> = { trainer: 'Trainers', handler: 'Handlers' };

function Shell({ unitName, scope, children }: { unitName?: string; scope: Role; children: ReactNode }) {
  return (
    <div className="screen">
      <Masthead />
      <header style={{ marginTop: 22 }}>
        <h1 style={{ fontSize: 34, lineHeight: 1, letterSpacing: '-0.01em' }}>Who are you?</h1>
      </header>
      <div className="band" style={{ marginTop: 10, justifyContent: 'space-between', gap: 10 }}>
        <span className="num" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{unitName ?? ''}</span>
        <span className="caps" style={{ color: 'var(--ink)', flex: 'none' }}>{LISTS[scope]}</span>
      </div>
      <main className="page">
        {children}
      </main>
    </div>
  );
}

export interface WhoAreYouViewProps {
  unitName?: string;
  scope: Role;
  names: NameChoice[];
  busy?: boolean;
  error?: string;
  onChoose: (memberId: string) => void;
  onAdd: (name: string) => void;
}

/** The names on this list as big buttons, and a way to add yours. */
function Body({ names, busy = false, error = '', onChoose, onAdd }: Omit<WhoAreYouViewProps, 'unitName' | 'scope'>) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const open = adding || names.length === 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean) onAdd(clean);
  };

  return (
    <>
      {names.length === 0 && (
        <p className="italic" style={{ fontSize: 20 }}>Nobody is on this list yet. Add your name to start.</p>
      )}
      {names.length > 0 && (
        <ul className="rows">
          {names.map((n) => (
            <li key={n.id}>
              <button type="button" className="row-btn" disabled={busy} onClick={() => onChoose(n.id)}
                style={{ minHeight: 68, fontSize: 28, fontWeight: 600, lineHeight: 1.1, opacity: busy ? 0.5 : 1 }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{n.name}</span>
                <ForwardChevron />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {open ? (
        <form onSubmit={submit} aria-label="Add my name" style={{ marginTop: 20 }}>
          <label className="label" htmlFor="who-name">Your name</label>
          <input id="who-name" className="field" value={name} required maxLength={60} autoComplete="name"
            enterKeyHint="go" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 14 }}>
            Add and continue
          </button>
        </form>
      ) : (
        <button type="button" className="btn btn-block" disabled={busy} onClick={() => setAdding(true)}
          style={{ marginTop: 20 }}>
          Add my name
        </button>
      )}
    </>
  );
}

/** "Who are you?": the names on this list as big buttons, and a way to add yours. Tap and you are in. */
export function WhoAreYouView({ unitName, scope, ...body }: WhoAreYouViewProps) {
  return <Shell unitName={unitName} scope={scope}><Body {...body} /></Shell>;
}

/** The screen a phone lands on after opening a link, and after "Switch": it fetches the list and signs in. */
export function WhoAreYouScreen({ scope }: { scope: Role }) {
  const [entered, setEntered] = useState<Entered | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setEntered(await loadNames());
    } catch (e) {
      // The link was replaced since this phone opened it: same as losing access anywhere else.
      if (e instanceof Error && /invalid link/i.test(e.message)) await markLost();
      else setLoadError(friendlyLinkError(e, 'Needs signal to show the names.'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(friendlyLinkError(e, 'Needs signal to sign in.'));
      if (e instanceof Error && /name not available/i.test(e.message)) void load();
    } finally {
      setBusy(false);
    }
  }

  // One Shell throughout, so the header does not flicker as the names arrive.
  return (
    <Shell unitName={entered?.unit_name} scope={entered?.scope ?? scope}>
      {loadError ? (
        <>
          <p role="alert" className="error">{loadError}</p>
          <button type="button" className="btn btn-block" style={{ marginTop: 12 }} onClick={() => void load()}>Try again</button>
        </>
      ) : !entered ? (
        <p role="status" className="italic">Getting the names&hellip;</p>
      ) : (
        <Body names={entered.names} busy={busy} error={error}
          onChoose={(id) => void run(() => chooseName(id))} onAdd={(name) => void run(() => addName(name))} />
      )}
    </Shell>
  );
}
