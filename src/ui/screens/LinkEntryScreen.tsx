import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { enterWithLink } from '../../data/account';
import { parseLink } from '../../domain/link';
import { DogDrawing } from '../components/DogDrawing';
import { HeaderBar } from '../components/HeaderBar';
import { INVALID_LINK, friendlyLinkError } from '../linkErrors';

/**
 * `#/trainer/<token>` and `#/handler/<token>`. Opens the link, then leaves the address: the route is
 * replaced (not pushed), so the token is neither in the address bar nor one Back press away. Nothing here
 * stores or prints the token; it goes to the server once.
 */
export function LinkEntryScreen() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setProblem('');
    void (async () => {
      const clean = parseLink(token);
      try {
        if (!clean) throw new Error('invalid link'); // not even worth asking the server
        await enterWithLink(clean);
        if (live) navigate('/', { replace: true });
      } catch (e) {
        if (!live) return;
        if (e instanceof Error && /invalid link/i.test(e.message)) {
          navigate('/link-problem', { replace: true, state: { message: INVALID_LINK } });
        } else {
          setProblem(friendlyLinkError(e, 'Needs signal to open the link.')); // the link stays in the address, to try again
        }
      }
    })();
    return () => { live = false; };
  }, [token, attempt, navigate]);

  return (
    <div className="screen">
      <HeaderBar title="Imprint" />
      <main className="pad" style={{ textAlign: 'center' }}>
        <DogDrawing />
        {problem ? (
          <>
            <p role="alert" className="error" style={{ fontSize: 18 }}>{problem}</p>
            <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 12 }}
              onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </>
        ) : (
          <p role="status" style={{ fontSize: 18, fontWeight: 800 }}>Opening your link&hellip;</p>
        )}
      </main>
    </div>
  );
}

/** Where a link that does not work lands: no token in the address, a plain message, a way back. */
export function LinkProblemScreen() {
  const navigate = useNavigate();
  const message = (useLocation().state as { message?: string } | null)?.message ?? INVALID_LINK;
  return (
    <div className="screen">
      <HeaderBar title="Imprint" />
      <main className="pad" style={{ textAlign: 'center' }}>
        <DogDrawing />
        <p style={{ fontSize: 20, fontWeight: 800 }}>{message}</p>
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 12 }}
          onClick={() => navigate('/', { replace: true })}>
          Back
        </button>
      </main>
    </div>
  );
}
