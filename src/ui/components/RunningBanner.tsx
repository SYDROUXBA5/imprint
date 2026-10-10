import { useNow } from '../../hooks/useNow';
import { formatClock } from '../../domain/format';

export interface RunningItem { dog: string; odour: string; handler: string; startedAt: string }

export function RunningBanner({ items }: { items: RunningItem[] }) {
  const now = useNow(items.length > 0 ? 1000 : null);
  if (items.length === 0) return null;
  return (
    <section aria-label="Running timers" style={{
      background: 'var(--mustard)', borderBottom: '1.5px solid var(--ink)', padding: '0 16px 10px',
      textAlign: 'center', fontWeight: 800, fontSize: 17,
    }}>
      {items.map((i) => (
        <p key={`${i.dog}|${i.odour}|${i.startedAt}`} className="num" style={{ margin: 0 }}>
          {`Running · ${i.dog} · ${i.odour} · ${formatClock((now - Date.parse(i.startedAt)) / 1000)} · ${i.handler}`}
        </p>
      ))}
    </section>
  );
}
