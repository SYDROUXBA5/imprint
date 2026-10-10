import { useEffect, useState, type FormEvent } from 'react';
import { createUnit, hasSession, joinUnit, loadMe, signIn, signUp } from '../../data/account';
import { DogDrawing } from '../components/DogDrawing';
import { HeaderBar } from '../components/HeaderBar';

type Mode = 'signin' | 'signup';
type UnitMode = 'create' | 'join';

/** Plain-language messages for the errors people actually hit. */
function friendly(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/not configured/i.test(message)) return "This copy of the app isn't connected to a server yet.";
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Needs signal once to sign in.';
  if (/failed to fetch|network|load failed|fetch/i.test(message) || (e instanceof Error && /Fetch/.test(e.name))) {
    return 'Needs signal once to sign in.';
  }
  if (/invalid invite code/i.test(message)) {
    return "That code doesn't match a unit. Ask your trainer for the current code.";
  }
  if (/already in a unit/i.test(message)) return 'This account already belongs to a unit.';
  return message;
}

function Choice<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1.5px solid var(--ink)',
      borderRadius: 999, overflow: 'hidden', margin: '16px 0 4px',
    }}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          style={{
            border: 0, borderRadius: 0, fontSize: 17, fontWeight: 800,
            background: o.value === value ? 'var(--ink)' : 'transparent',
            color: o.value === value ? 'var(--paper)' : 'var(--ink)',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function WelcomeScreen() {
  const [step, setStep] = useState<'auth' | 'unit'>('auth');
  const [mode, setMode] = useState<Mode>('signin');
  const [unitMode, setUnitMode] = useState<UnitMode>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [unitName, setUnitName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Signed in on this device before (e.g. closed the app before choosing a unit): pick up where they left off.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (await hasSession() && !(await loadMe()) && live) setStep('unit');
      } catch { /* no signal or no server: stay on the sign-in form */ }
    })();
    return () => { live = false; };
  }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }

  const submitAuth = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === 'signup') {
        await signUp(email.trim(), password);
        if (!(await hasSession())) {
          setMode('signin');
          setNotice('Check your email to confirm your account, then sign in.');
          return;
        }
        setStep('unit');
        return;
      }
      await signIn(email.trim(), password);
      // A member is stored locally and the app moves on by itself; otherwise choose a unit.
      if (!(await loadMe())) setStep('unit');
    });
  };

  const submitUnit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (unitMode === 'create') await createUnit(unitName, name);
      else await joinUnit(code, name);
    });
  };

  return (
    <div className="screen">
      <HeaderBar title="Imprint" />
      <main className="pad">
        <div style={{ display: 'grid', justifyItems: 'center', gap: 4, textAlign: 'center' }}>
          <DogDrawing />
          <p style={{ margin: 0, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Trainer&rsquo;s field guide
          </p>
        </div>

        {step === 'auth' ? (
          <form onSubmit={submitAuth} aria-label="Account">
            <Choice label="Account" value={mode} onChange={(m) => { setMode(m); setError(''); setNotice(''); }}
              options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Sign up' }]} />
            {mode === 'signup' && (
              <>
                <label className="label" htmlFor="w-name">Your name</label>
                <input id="w-name" className="field" value={name} onChange={(e) => setName(e.target.value)}
                  autoComplete="name" required />
              </>
            )}
            <label className="label" htmlFor="w-email">Email</label>
            <input id="w-email" className="field" type="email" value={email} autoComplete="email" required
              onChange={(e) => setEmail(e.target.value)} />
            <label className="label" htmlFor="w-pw">Password</label>
            <input id="w-pw" className="field" type="password" value={password} required minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)} />
            {notice && <p role="status" style={{ fontWeight: 700 }}>{notice}</p>}
            {error && <p role="alert" className="error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
              Continue
            </button>
          </form>
        ) : (
          <form onSubmit={submitUnit} aria-label="Unit">
            <h2 style={{ marginTop: 16, fontSize: 22, textAlign: 'center' }}>Join or start a unit</h2>
            <Choice label="Unit" value={unitMode} onChange={(m) => { setUnitMode(m); setError(''); }}
              options={[{ value: 'create', label: 'Create a unit' }, { value: 'join', label: 'Join with a code' }]} />
            {unitMode === 'create' ? (
              <>
                <label className="label" htmlFor="w-unit">Unit name</label>
                <input id="w-unit" className="field" value={unitName} required onChange={(e) => setUnitName(e.target.value)} />
              </>
            ) : (
              <>
                <label className="label" htmlFor="w-code">Invite code</label>
                <input id="w-code" className="field" value={code} required autoCapitalize="characters"
                  autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)}
                  style={{ textTransform: 'uppercase', letterSpacing: 4, fontWeight: 800 }} />
              </>
            )}
            <label className="label" htmlFor="w-mname">Your name</label>
            <input id="w-mname" className="field" value={name} required autoComplete="name"
              onChange={(e) => setName(e.target.value)} />
            {error && <p role="alert" className="error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
              {unitMode === 'create' ? 'Create unit' : 'Join unit'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
