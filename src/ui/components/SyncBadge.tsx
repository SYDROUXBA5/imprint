const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;
const records = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`;

/** The sync status as one typed line at the foot of the page. */
export function SyncBadge({ pending, rejected, stale }: { pending: number; rejected: number; stale: boolean }) {
  const settled = pending === 0 && rejected === 0;
  return (
    <div role="status" className="sync-line">
      {settled && <p>Everything saved and synced.</p>}
      {pending > 0 && <p>{`${changes(pending)} waiting to sync.`}</p>}
      {pending > 0 && stale && <p>Open with signal before clearing this phone.</p>}
      {rejected > 0 && <p className="error">{`${records(rejected)} rejected by the server`}</p>}
    </div>
  );
}
