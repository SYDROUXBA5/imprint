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

const boxed = { padding: 12, border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)' } as const;

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
    <section aria-label={title} style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 22 }}>{title}</h2>
      {list.length === 0 && <p className="muted" style={{ margin: '8px 0 0' }}>Nobody yet.</p>}
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 12 }}>
        {list.map((m) => (
          <li key={m.id} style={boxed}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{m.name}</span>
              {m.id === me.id ? (
                <span className="muted" style={{ fontWeight: 700 }}>you</span>
              ) : (
                <button type="button" className="btn" style={{ marginLeft: 'auto', fontSize: 16 }} disabled={locked}
                  aria-label={`Remove ${m.name}`}
                  onClick={() => { setError(''); setConfirm({ kind: 'remove', member: m }); }}>
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="screen">
      <HeaderBar title="Members" onBack={() => navigate('/')} />
      <main className="pad">
        {!online && (
          <p role="status" style={{ margin: '0 0 12px', fontWeight: 800 }}>Member changes need signal.</p>
        )}
        {linksError && (
          <div>
            <p role="alert" className="error">{linksError}</p>
            <button type="button" className="btn" style={{ width: '100%', marginTop: 8 }} onClick={() => void loadLinks()}>
              Try again
            </button>
          </div>
        )}
        {copyError && <p role="alert" className="error">{copyError}</p>}
        {copied && <p role="status" style={{ margin: '0 0 8px', fontWeight: 800 }}>Copied</p>}

        {links && (
          <div style={{ display: 'grid', gap: 16 }}>
            {CARDS.map((c) => (
              <section key={c.role} aria-label={c.title} style={{ ...boxed, padding: 14 }}>
                <h2 style={{ fontSize: 22 }}>{c.title}</h2>
                <p className="muted" style={{ margin: '2px 0 8px' }}>{c.about}</p>
                <p data-testid={`${c.role}-link`} style={{
                  margin: '0 0 12px', padding: '8px 10px', border: '1.5px dashed var(--ink)', borderRadius: 10,
                  fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.4, overflowWrap: 'anywhere', userSelect: 'all',
                }}>
                  {addressOf(c.role, links[c.role])}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn" style={{ flex: 1, fontSize: 16 }} onClick={() => void copy(c.role)}>Copy</button>
                  {canShare && (
                    <button type="button" className="btn" style={{ flex: 1, fontSize: 16 }} onClick={() => void share(c.role)}>Share</button>
                  )}
                  <button type="button" className="btn" style={{ flex: 1, fontSize: 16 }} disabled={locked}
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

        <section aria-label="Export" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Export</h2>
          <ExportButton label="Export all sessions (CSV)" run={() => exportAllSessionsCsv(db)} />
        </section>

        {removed.length > 0 && (
          <section aria-label="Removed" style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 22 }}>Removed</h2>
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 8 }}>
              {removed.map((m) => (
                <li key={m.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 12px', opacity: 0.55,
                  border: '1.5px dashed var(--ink)', borderRadius: 'var(--radius)',
                }}>
                  <span style={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{m.name}</span>
                  <span>{m.role === 'trainer' ? 'Trainer' : 'Handler'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {confirm && (
        <Sheet open onClose={closeConfirm}
          title={confirm.kind === 'link' ? (confirm.role === 'trainer' ? 'New trainer link' : 'New handler link') : 'Remove member'}>
          <p style={{ fontSize: 18 }}>
            {confirm.kind === 'link'
              ? 'Everyone using the old link will need the new one.'
              : `Remove ${confirm.member.name}? Their past sessions stay in the log.`}
          </p>
          {confirm.kind === 'remove' && (
            <p className="muted" style={{ fontSize: 16 }}>To really cut someone off, also make a new link.</p>
          )}
          {!online && <p className="error">Member changes need signal.</p>}
          {error && <p role="alert" className="error">{error}</p>}
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={closeConfirm}>Cancel</button>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={locked} onClick={confirmed}>
              {confirm.kind === 'link' ? 'Make new link' : `Remove ${confirm.member.name}`}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
