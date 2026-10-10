import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadMe, regenerateInviteCode, removeMember, setRole } from '../../data/account';
import { db } from '../../data/db';
import type { Member, Role } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { useOnline } from '../../hooks/useOnline';
import { useUnitData } from '../../hooks/useUnitData';
import { HeaderBar } from '../components/HeaderBar';
import { Sheet } from '../components/Sheet';

type Confirm = { kind: 'code' } | { kind: 'remove'; member: Member } | null;

/** "a unit needs at least one trainer" -> "A unit needs at least one trainer." */
function sentence(e: unknown): string {
  const msg = e instanceof Error ? e.message.trim() : '';
  if (!msg) return 'That did not work. Try again.';
  const capped = msg[0].toUpperCase() + msg.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

const byName = (a: Member, b: Member) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Trainer-only (the route sends handlers home). Every change goes to the server, so it needs signal. */
export function TeamScreen() {
  const me = useMe();
  const { members, unit, loading } = useUnitData();
  const online = useOnline();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (loading || !me) return null;
  const active = members.filter((m) => !m.removed_at).sort(byName);
  const removed = members.filter((m) => m.removed_at).sort(byName);
  const locked = !online || busy;

  /** Run a server change; then refresh who I am (my own role may have changed) and let the sync loop catch up. */
  async function run(change: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      await change();
    } catch (e) {
      setError(sentence(e));
      setBusy(false);
      return false;
    }
    try { await loadMe(); } catch { /* the sync loop refreshes it */ }
    setBusy(false);
    return true;
  }

  const changeRole = (m: Member, role: Role) => run(async () => {
    await setRole(m.id, role);
    await db.members.update(m.id, { role }); // show it at once; the next sync confirms it
  });

  async function confirmed() {
    if (!confirm) return;
    const ok = confirm.kind === 'code'
      ? await run(async () => {
        const code = await regenerateInviteCode();
        if (unit) await db.units.update(unit.id, { invite_code: code });
      })
      : await run(async () => {
        await removeMember(confirm.member.id);
        await db.members.update(confirm.member.id, { removed_at: new Date().toISOString() });
      });
    if (ok) setConfirm(null);
  }

  const closeConfirm = () => { setConfirm(null); setError(''); };

  return (
    <div className="screen">
      <HeaderBar title="Team" onBack={() => navigate('/')} />
      <main className="pad">
        <section aria-label="Invite code" style={{
          padding: 14, textAlign: 'center', border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)',
        }}>
          <p style={{ margin: 0, fontWeight: 800 }}>Invite code</p>
          <p data-testid="invite-code" className="num" style={{
            margin: '4px 0', fontSize: 44, lineHeight: 1.1, fontWeight: 800, letterSpacing: '10px', paddingLeft: 10,
            overflowWrap: 'anywhere',
          }}>
            {unit?.invite_code ?? '······'}
          </p>
          <p className="muted" style={{ margin: '0 0 12px' }}>Give this to handlers so they can join.</p>
          <button type="button" className="btn" disabled={locked}
            onClick={() => { setError(''); setConfirm({ kind: 'code' }); }}>
            New code
          </button>
        </section>

        {!online && (
          <p role="status" style={{ margin: '12px 0 0', fontWeight: 800 }}>Team changes need signal.</p>
        )}
        {error && !confirm && <p role="alert" className="error">{error}</p>}

        <section aria-label="Members" style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 22 }}>Members</h2>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 12 }}>
            {active.map((m) => (
              <li key={m.id} style={{
                padding: 12, border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{m.name}</span>
                  {m.id === me.id && <span className="muted" style={{ fontWeight: 700 }}>you</span>}
                  <span style={{
                    marginLeft: 'auto', padding: '2px 10px', border: '1.5px solid var(--ink)', borderRadius: 999,
                    fontSize: 14, fontWeight: 800, background: m.role === 'trainer' ? 'var(--mustard)' : 'var(--paper)',
                  }}>
                    {m.role === 'trainer' ? 'Trainer' : 'Handler'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn" style={{ flex: 1, fontSize: 16 }} disabled={locked}
                    aria-label={m.role === 'trainer' ? `Make ${m.name} a handler` : `Make ${m.name} a trainer`}
                    onClick={() => changeRole(m, m.role === 'trainer' ? 'handler' : 'trainer')}>
                    {m.role === 'trainer' ? 'Make handler' : 'Make trainer'}
                  </button>
                  <button type="button" className="btn" style={{ flex: 1, fontSize: 16 }} disabled={locked}
                    aria-label={`Remove ${m.name}`}
                    onClick={() => { setError(''); setConfirm({ kind: 'remove', member: m }); }}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
        <Sheet open onClose={closeConfirm} title={confirm.kind === 'code' ? 'New invite code' : 'Remove member'}>
          <p style={{ fontSize: 18 }}>
            {confirm.kind === 'code'
              ? 'The old code will stop working.'
              : `Remove ${confirm.member.name}? Their past sessions stay in the log.`}
          </p>
          {!online && <p className="error">Team changes need signal.</p>}
          {error && <p role="alert" className="error">{error}</p>}
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={closeConfirm}>Cancel</button>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={locked} onClick={confirmed}>
              {confirm.kind === 'code' ? 'Make new code' : `Remove ${confirm.member.name}`}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
