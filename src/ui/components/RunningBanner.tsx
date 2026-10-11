import { useNow } from '../../hooks/useNow';
import { formatTypedClock } from '../../domain/format';

export interface RunningItem { dog: string; odour: string; handler: string; startedAt: string }

/** One brass-outlined box per timer running right now: "Kestrel on C4/RDX, with Tom" and its time. */
export function RunningBanner({ items }: { items: RunningItem[] }) {
  const now = useNow(items.length > 0 ? 1000 : null);
  if (items.length === 0) return null;
  return (
    <section aria-label="Running timers">
      {items.map((i) => (
        <div key={`${i.dog}|${i.odour}|${i.startedAt}`} className="running-box">
          <div className="running-box-main">
            <div className="caps">Running now</div>
            <div className="running-line">{`${i.dog} on ${i.odour}, with ${i.handler}`}</div>
          </div>
          <div className="running-time">{formatTypedClock((now - Date.parse(i.startedAt)) / 1000)}</div>
        </div>
      ))}
    </section>
  );
}
