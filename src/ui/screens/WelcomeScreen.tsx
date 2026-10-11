import { useState, type FormEvent } from 'react';
import { enterWithLink } from '../../data/account';
import { parseLink } from '../../domain/link';
import { Masthead } from '../components/Masthead';
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
      <Masthead as="h1" />
      <main className="page" style={{ marginTop: 20 }}>
        <div style={{ borderTop: '1.5px solid var(--ink)', paddingTop: 14 }}>
          <p style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>
            {lost
              ? 'Your link has changed. Ask your trainer for the new one.'
              : 'Open the link your trainer sent you, or paste it here.'}
          </p>
          {lost && (
            <p className="italic soft" style={{ margin: '8px 0 0' }}>
              What you recorded is kept on this phone.
            </p>
          )}
        </div>

        <form onSubmit={submit} aria-label="Open a link" style={{ marginTop: 8 }}>
          <label className="label" htmlFor="w-link">Your link</label>
          <input id="w-link" className="field" value={pasted} autoComplete="off" autoCapitalize="none" spellCheck={false}
            inputMode="url" onChange={(e) => setPasted(e.target.value)} />
          {error && <p role="alert" className="error">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 18 }}>
            Open
          </button>
        </form>
      </main>
    </div>
  );
}
