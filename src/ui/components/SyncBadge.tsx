const records = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`;

export function SyncBadge({ pending, rejected, stale }: { pending: number; rejected: number; stale: boolean }) {
  if (pending === 0 && rejected === 0) return null;
  return (
    <div role="status" style={{
      margin: '8px 16px', padding: '8px 12px', border: '1.5px solid var(--ink)', borderRadius: 10,
      background: 'var(--paper)', fontWeight: 700,
    }}>
      {pending > 0 && <p style={{ margin: 0 }}>{records(pending)} not synced yet</p>}
      {pending > 0 && stale && <p style={{ margin: 0 }}>Open with signal before clearing this phone.</p>}
      {rejected > 0 && (
        <p style={{ margin: 0, color: 'var(--stamp)' }}>{records(rejected)} rejected by the server</p>
      )}
    </div>
  );
}
