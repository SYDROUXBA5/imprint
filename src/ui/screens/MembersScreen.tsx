import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLinks, regenerateLink, removeMember, type Links } from '../../data/account';
import { db } from '../../data/db';
import { buildLink } from '../../domain/link';
import { exportAllSessionsCsv } from '../../export/run';
import type { Member, Role } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { useOnline } from '../../hooks/useOnline';
import { useUnitData } from '../../hooks/useUnitData';
import { ExportButton } from '../components/ExportButton';
import { HeaderBar } from '../components/HeaderBar';
import { Sheet } from '../components/Sheet';
import { friendlyLinkError } from '../linkErrors';

type Confirm = { kind: 'link'; role: Role } | { kind: 'remove'; member: Member } | null;

/** "a unit needs at least one trainer" -> "A unit needs at least one trainer." */
function sentence(e: unknown): string {
  const msg = e instanceof Error ? e.message.trim() : '';
  if (!msg) return 'That did not work. Try again.';
  const capped = msg[0].toUpperCase() + msg.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

const byName = (a: Member, b: Member) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const CARDS: { role: Role; title: string; about: string }[] = [
  { role: 'trainer', title: 'Trainer link', about: 'Full control. Share only with trainers.' },
  { role: 'handler', title: 'Handler link', about: 'Handlers choose a dog and add time.' },
];

/** The address people open: this app's own address, with the role and token after the #. */
const addressOf = (role: Role, token: string) => buildLink(role, token, window.location.origin, import.meta.env.BASE_URL);

/**
 * The unit's people and the two secret links (spec §14). Trainer-only (the route sends handlers home).
 * The links are fetched when the screen opens and shown here; they are never stored on the phone.
 * Every change goes to the server, so it needs signal.
 */
export function MembersScreen() {
  const me = useMe();
  const { members, loading } = useUnitData();
  const online = useOnline();
  const navigate = useNavigate();
  const [links, setLinks] = useState<Links | null>(null);
  const [linksError, setLinksError] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<Role | null>(null);
  const [copyError, setCopyError] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const loadLinks = useCallback(async () => {
    setLinksError('');
    try {
      setLinks(await getLinks());
    } catch (e) {
      setLinksError(friendlyLinkError(e, 'Needs signal to show the links.'));
    }
  }, []);
  useEffect(() => { void loadLinks(); }, [loadLinks]);

  if (loading || !me) return null;
  const active = members.filter((m) => !m.removed_at);
  const trainers = active.filter((m) => m.role === 'trainer').sort(byName);
  const handlers = active.filter((m) => m.role === 'handler').sort(byName);
  const removed = members.filter((m) => m.removed_at).sort(byName);
  const locked = !online || busy;

  async function copy(role: Role) {
    if (!links) return;
    setCopyError('');
    setCopied(null);
    try {
      await navigator.clipboard.writeText(addressOf(role, links[role]));
      setCopied(role);
    } catch {
      setCopyError('Could not copy. Press and hold the link to copy it.');
    }
  }

  async function share(role: Role) {
    if (!links) return;
    try {
      await navigator.share({ title: 'Imprint', text: `Imprint ${role} link`, url: addressOf(role, links[role]) });
    } catch { /* closing the share sheet is not an error */ }
  }

  /** Run a server change. */
  async function run(change: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      await change();
      return true;
    } catch (e) {
      setError(sentence(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmed() {
    if (!confirm) return;
    const ok = confirm.kind === 'link'
      ? await run(async () => {
        const token = await regenerateLink(confirm.role);
        setLinks((prev) => (prev ? { ...prev, [confirm.role]: token } : prev));
        setCopied(null);
      })
      : await run(() => removeMember(confirm.member.id));
    if (ok) setConfirm(null);
  }

  const closeConfirm = () => { setConfirm(null); setError(''); };

  const people = (title: string, list: Member[]) => (
    <section aria-label={title} className="section">
      <h2>{title}</h2>
      {list.length === 0 && <p className="italic soft">Nobody yet.</p>}
      <ul className="rows">
        {list.map((m) => (
          <li key={m.id} className="odour-edit-row" style={{ minHeight: 60 }}>
            <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1, overflowWrap: 'break-word' }}>{m.name}</span>
            {m.id === me.id ? (
              <span className="num soft" style={{ fontSize: 14 }}>you</span>
            ) : (
              <button type="button" className="btn btn-sm" disabled={locked}
                aria-label={`Remove ${m.name}`}
                onClick={() => { setError(''); setConfirm({ kind: 'remove', member: m }); }}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="screen">
      <HeaderBar title="Members" onBack={() => navigate('/')} />
      <main className="page">
        {!online && (
          <p role="status" className="note">Member changes need signal.</p>
        )}
        {linksError && (
          <div>
            <p role="alert" className="error">{linksError}</p>
            <button type="button" className="btn btn-block" style={{ marginTop: 10 }} onClick={() => void loadLinks()}>
              Try again
            </button>
          </div>
        )}
        {copyError && <p role="alert" className="error">{copyError}</p>}
        {copied && <p role="status" className="hint">Copied</p>}

        {links && (
          <div>
            {CARDS.map((c) => (
              <section key={c.role} aria-label={c.title} className="section">
                <h2>{c.title}</h2>
                <p className="italic soft" style={{ margin: '2px 0 10px' }}>{c.about}</p>
                <p data-testid={`${c.role}-link`} className="link-box">
                  {addressOf(c.role, links[c.role])}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn" style={{ flex: 1 }} onClick={() => void copy(c.role)}>Copy</button>
                  {canShare && (
                    <button type="button" className="btn" style={{ flex: 1 }} onClick={() => void share(c.role)}>Share</button>
                  )}
                  <button type="button" className="btn" style={{ flex: 1 }} disabled={locked}
                    onClick={() => { setError(''); setConfirm({ kind: 'link', role: c.role }); }}>
                    New link
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}

        {error && !confirm && <p role="alert" className="error">{error}</p>}

        {people('Trainers', trainers)}
        {people('Handlers', handlers)}

        <section aria-label="Export" className="section">
          <h2 style={{ marginBottom: 10 }}>Export</h2>
          <ExportButton label="Export all sessions (CSV)" run={() => exportAllSessionsCsv(db)} />
        </section>

        {removed.length > 0 && (
          <section aria-label="Removed" className="section">
            <h2>Removed</h2>
            <ul className="rows">
              {removed.map((m) => (
                <li key={m.id} className="odour-edit-row soft" style={{ minHeight: 48 }}>
                  <span style={{ fontSize: 20, overflowWrap: 'anywhere' }}>{m.name}</span>
                  <span className="num" style={{ fontSize: 14 }}>{m.role === 'trainer' ? 'Trainer' : 'Handler'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {confirm && (
        <Sheet open onClose={closeConfirm}
          title={confirm.kind === 'link' ? (confirm.role === 'trainer' ? 'New trainer link' : 'New handler link') : 'Remove member'}>
          <p className="sheet-text">
            {confirm.kind === 'link'
              ? 'Everyone using the old link will need the new one.'
              : `Remove ${confirm.member.name}? Their past sessions stay in the log.`}
          </p>
          {confirm.kind === 'remove' && (
            <p className="hint">To really cut someone off, also make a new link.</p>
          )}
          {!online && <p className="error">Member changes need signal.</p>}
          {error && <p role="alert" className="error">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={closeConfirm}>Cancel</button>
            <button type="button" className={`btn btn-primary${confirm.kind === 'remove' ? ' btn-danger' : ''}`} disabled={locked} onClick={confirmed}>
              {confirm.kind === 'link' ? 'Make new link' : `Remove ${confirm.member.name}`}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
