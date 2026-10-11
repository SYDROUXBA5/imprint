import { useState, type FormEvent } from 'react';
import { enterWithLink } from '../../data/account';
import { parseLink } from '../../domain/link';
import { DogDrawing } from '../components/DogDrawing';
import { HeaderBar } from '../components/HeaderBar';
import { friendlyLinkError } from '../linkErrors';

/**
 * A phone with no way in: first visit without a link, storage cleared, a freshly installed home-screen app
 * (on iPhone it starts with empty storage), or a link that has been replaced (`lost`). There is nothing to
 * sign up for: open the link, or paste it here.
 */
export function WelcomeScreen({ lost = false }: { lost?: boolean }) {
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = parseLink(pasted);
    if (!token) {
      setError("That doesn't look like an Imprint link. Paste the whole link, or just its 32 letters and numbers.");
      return;
    }
    setBusy(true);
    setError('');
    try {
      await enterWithLink(token); // the phone is now "entered"; the app moves on to Who are you? by itself
    } catch (err) {
      setError(friendlyLinkError(err, 'Needs signal to open the link.'));
      if (err instanceof Error && /invalid link/i.test(err.message)) setPasted(''); // a dead link is no use to keep
    } finally {
      setBusy(false);
    }
  }

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

        <p style={{ margin: '20px 0 0', fontSize: 20, fontWeight: 800, textAlign: 'center' }}>
          {lost
            ? 'Your link has changed. Ask your trainer for the new one.'
            : 'Open the link your trainer sent you, or paste it here.'}
        </p>
        {lost && (
          <p className="muted" style={{ margin: '8px 0 0', textAlign: 'center' }}>
            What you recorded is kept on this phone.
          </p>
        )}

        <form onSubmit={submit} aria-label="Open a link" style={{ marginTop: 8 }}>
          <label className="label" htmlFor="w-link">Your link</label>
          <input id="w-link" className="field" value={pasted} autoComplete="off" autoCapitalize="none" spellCheck={false}
            inputMode="url" onChange={(e) => setPasted(e.target.value)} />
          {error && <p role="alert" className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
            Open
          </button>
        </form>
      </main>
    </div>
  );
}
