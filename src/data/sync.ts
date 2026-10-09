import type { ImprintDB, OutboxItem } from './db';
import type { PulledTable, RemoteError, RemoteStore } from './remote';

export interface SyncDeps {
  db: ImprintDB;
  remote: RemoteStore;
  unitId: string;
  now?: () => Date;
}

const SERVER_FIELDS = ['server_received_at', 'client_clock_offset_s', 'updated_at'];
const PERMANENT_CODES = new Set(['42501', '23514', '23503', '23502', '22P02', 'P0002']);
const PULL_TABLES: PulledTable[] = ['units', 'members', 'dogs', 'sessions', 'corrections'];
const CURSOR_OVERLAP_MS = 5000;
const STALE_MS = 24 * 60 * 60 * 1000;

const isPermanent = (e: RemoteError) => !!e.code && PERMANENT_CODES.has(e.code);
const nowOf = (d: SyncDeps) => (d.now ?? (() => new Date()))();

async function send(d: SyncDeps, item: OutboxItem): Promise<{ error?: RemoteError }> {
  const row: Record<string, unknown> = { ...item.row };
  for (const f of SERVER_FIELDS) delete row[f];
  if (item.table === 'sessions') row.client_sent_at = nowOf(d).toISOString();
  if (item.op === 'insert') return d.remote.insert(item.table, row);
  const { id, ...patch } = row;
  return d.remote.update(item.table, id as string, patch);
}

export async function pushOutbox(d: SyncDeps) {
  const items = await d.db.outbox.where('status').equals('pending').sortBy('seq');
  let pushed = 0, rejected = 0;
  for (const item of items) {
    const { error } = await send(d, item);
    if (!error) {
      await d.db.outbox.delete(item.seq!);
      pushed++;
    } else if (isPermanent(error)) {
      await d.db.outbox.update(item.seq!, { status: 'rejected', error: error.message });
      rejected++;
    } else {
      return { pushed, rejected, stalled: true };
    }
  }
  return { pushed, rejected, stalled: false };
}

export async function pullChanges(d: SyncDeps): Promise<void> {
  const pending = await d.db.outbox.where('status').equals('pending').toArray();
  const pendingIds = new Set(pending.map((i) => i.row.id));
  for (const table of PULL_TABLES) {
    const key = `cursor:${table}`;
    const cursor = ((await d.db.meta.get(key))?.value as string) ?? '1970-01-01T00:00:00.000Z';
    const since = new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString();
    const { rows, error } = await d.remote.changesSince(table, d.unitId, since);
    if (error) throw new Error(error.message);
    if (rows.length === 0) continue;
    const fresh = rows.filter((r) => !pendingIds.has(r.id as string));
    await d.db.table(table).bulkPut(fresh);
    const newest = rows.reduce((m, r) => ((r.updated_at as string) > m ? (r.updated_at as string) : m), cursor);
    await d.db.meta.put({ key, value: newest });
  }
}

export async function syncOnce(d: SyncDeps) {
  const push = await pushOutbox(d);
  if (!push.stalled) await pullChanges(d);
  return push;
}

/** Counts records (distinct ids), not outbox rows: a session's Start and Stop are one record. */
export async function syncStatus(db: ImprintDB, now = new Date()) {
  const pending = await db.outbox.where('status').equals('pending').sortBy('seq');
  const rejected = await db.outbox.where('status').equals('rejected').toArray();
  const oldest = pending[0]?.created_at;
  return {
    pending: new Set(pending.map((i) => i.row.id)).size,
    rejected: new Set(rejected.map((i) => i.row.id)).size,
    stale: !!oldest && now.getTime() - Date.parse(oldest) > STALE_MS,
  };
}
