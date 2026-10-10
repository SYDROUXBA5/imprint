import { useMemo, useState, type CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { needsClockCheck, overlappingSessionIds } from '../../domain/flags';
import { formatClock, formatDay, formatMinSec, localDate } from '../../domain/format';
import { NOT_IN_CURRENT_LIST, isInTeamList, odourName, sortOdours } from '../../domain/odours';
import { trainedOdours } from '../../domain/progress';
import { currentDuration, isRunning, latestCorrection, liveElapsed } from '../../domain/totals';
import type { Correction, Member, Session } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { useUnitData } from '../../hooks/useUnitData';
import { HeaderBar } from '../components/HeaderBar';
import { CorrectionSheet } from './CorrectionSheet';

const pill: CSSProperties = {
  display: 'inline-block', padding: '2px 10px', border: '1.5px solid var(--ink)', borderRadius: 999,
  fontSize: 14, fontWeight: 800, background: 'var(--paper)',
};
const flagPill: CSSProperties = { ...pill, background: 'var(--mustard)' };

/** Newest first. A timed session sorts by when it started, a manual one by its date. */
const sortKey = (s: Session) => s.started_at ?? s.session_date;

const dayOf = (iso: string) => formatDay(localDate(new Date(iso)), false);

/** Beside an odour name: it is not in the team's current list any more. */
const Marker = () => <span className="muted" style={{ marginLeft: 6, fontSize: 14, fontWeight: 700 }}>{NOT_IN_CURRENT_LIST}</span>;

interface Editing { session: Session; mode: 'correct' | 'void' }

export function LogScreen() {
  const { dogId = '' } = useParams();
  const me = useMe();
  const { dogs, members, sessions, corrections, odours, catalogue, loading } = useUnitData();
  const navigate = useNavigate();
  const [odourFilter, setOdourFilter] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);

  const dogSessions = useMemo(() => sessions.filter((s) => s.dog_id === dogId), [sessions, dogId]);
  const anyRunning = dogSessions.some((s) => isRunning(s, corrections));
  const now = useNow(anyRunning ? 1000 : null);

  const sorted = useMemo(
    () => [...dogSessions].sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || b.id.localeCompare(a.id)),
    [dogSessions],
  );
  // A voided session is out of the picture, so it neither is flagged nor flags the one next to it.
  const overlapping = useMemo(
    () => overlappingSessionIds(dogSessions.filter((s) => !latestCorrection(s.id, corrections)?.void), now),
    [dogSessions, corrections, now],
  );

  if (loading || !me) return null;
  const dog = dogs.find((d) => d.id === dogId);
  if (!dog) return <Navigate to="/" replace />;

  const isTrainer = me.role === 'trainer';
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';
  const totals = trainedOdours(dog.id, dogSessions, corrections, odours, now);
  const loggedOdours = sortOdours(odours.filter((o) => dogSessions.some((s) => s.odour_id === o.id)));
  const shown = odourFilter ? sorted.filter((s) => s.odour_id === odourFilter) : sorted;
  // Time logged on an odour the team no longer trains on stays here, marked (spec §13.4).
  const notListed = (odourId: string) => !isInTeamList(dog.team_id, odourId, catalogue);
  const labelOf = (odourId: string) =>
    `${odourName(odours, odourId)}${notListed(odourId) ? ` ${NOT_IN_CURRENT_LIST}` : ''}`;

  return (
    <div className="screen">
      <HeaderBar title="Log" onBack={() => navigate(`/dog/${dog.id}`)} />
      <main className="pad">
        <h2 style={{ fontSize: 24, overflowWrap: 'anywhere' }}>{dog.name}</h2>

        {totals.length > 0 && (
          <section aria-label="Totals" style={{ marginTop: 12 }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {totals.map((t) => (
                <li key={t.odourId} style={{
                  display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 12px',
                  border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)',
                }}>
                  <span style={{ fontWeight: 800 }}>{t.name}{notListed(t.odourId) && <Marker />}</span>
                  <span className="num">{formatMinSec(t.totalS)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {dogSessions.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <label className="label" htmlFor="log-odour" style={{ marginTop: 0 }}>Odour</label>
            <select id="log-odour" className="field" value={odourFilter} onChange={(e) => setOdourFilter(e.target.value)}>
              <option value="">All odours</option>
              {loggedOdours.map((o) => <option key={o.id} value={o.id}>{labelOf(o.id)}</option>)}
            </select>
          </div>
        )}

        {dogSessions.length === 0 && (
          <p style={{ marginTop: 24, textAlign: 'center', fontWeight: 800 }}>Nothing logged yet</p>
        )}

        <ul aria-label="Sessions" style={{
          listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12,
        }}>
          {shown.map((s) => (
            <LogRow key={s.id} session={s} corrections={corrections} now={now} nameOf={nameOf} odourLabel={odourName(odours, s.odour_id)}
              notListed={notListed(s.odour_id)} flagged={overlapping.has(s.id)} isTrainer={isTrainer}
              onEdit={(mode) => setEditing({ session: s, mode })} />
          ))}
        </ul>
      </main>

      {editing && (
        <CorrectionSheet key={`${editing.session.id}-${editing.mode}`} me={me as Member}
          sessionId={editing.session.id} mode={editing.mode}
          currentS={currentDuration(editing.session, corrections)}
          summary={`${labelOf(editing.session.odour_id)} · ${formatDay(editing.session.session_date)} · ${nameOf(editing.session.handler_id)}`}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface LogRowProps {
  session: Session;
  corrections: Correction[];
  now: number;
  nameOf: (memberId: string) => string;
  odourLabel: string;
  notListed: boolean;
  flagged: boolean;
  isTrainer: boolean;
  onEdit: (mode: 'correct' | 'void') => void;
}

function LogRow({ session: s, corrections, now, nameOf, odourLabel: odour, notListed, flagged, isTrainer, onEdit }: LogRowProps) {
  const date = formatDay(s.session_date);
  const correction = latestCorrection(s.id, corrections);
  const running = isRunning(s, corrections);
  const current = currentDuration(s, corrections);

  return (
    <li style={{
      padding: 12, border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{date}</div>
          <div style={{ fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>
            <span>{odour}{notListed && <Marker />}</span>
          </div>
          <div>
            <span>{nameOf(s.handler_id)}</span>
          </div>
        </div>
        <div className="num" style={{ fontSize: 22, fontWeight: 800, textAlign: 'right', flex: 'none' }}>
          {running ? (
            <span data-testid="live-clock">{formatClock(liveElapsed(s, corrections, now))}</span>
          ) : correction ? (
            <>
              <s style={{ fontSize: 16, fontWeight: 700, marginRight: 8, opacity: 0.75 }}>{formatClock(s.duration_s ?? 0)}</s>
              <span>{formatClock(current)}</span>
            </>
          ) : (
            <span>{formatClock(current)}</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        <span style={pill}>{running ? 'Running' : s.kind === 'timed' ? 'Timed' : 'Manual'}</span>
        {correction && !correction.void && (
          <span style={pill}>{`Corrected by ${nameOf(correction.trainer_id)}, ${dayOf(correction.created_at)}`}</span>
        )}
        {correction?.void && <span style={{ ...pill, color: 'var(--stamp)', borderColor: 'var(--stamp)' }}>Voided</span>}
        {flagged && <span style={flagPill}>Overlap</span>}
        {needsClockCheck(s) && <span style={flagPill}>Clock check</span>}
      </div>

      {correction && (
        <p style={{ margin: '8px 0 0', overflowWrap: 'anywhere' }}>
          {correction.void ? `By ${nameOf(correction.trainer_id)}, ${dayOf(correction.created_at)}. ` : ''}
          {`Reason: ${correction.reason}`}
        </p>
      )}

      {isTrainer && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn" style={{ flex: 1, fontSize: 16 }}
            aria-label={`Correct ${odour} session of ${date}`} onClick={() => onEdit('correct')}>
            Correct
          </button>
          <button type="button" className="btn" style={{ flex: 1, fontSize: 16 }}
            aria-label={`Void ${odour} session of ${date}`} onClick={() => onEdit('void')}>
            Void
          </button>
        </div>
      )}
    </li>
  );
}
