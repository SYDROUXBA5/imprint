import type { SupabaseClient } from '@supabase/supabase-js';
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
// Tombstones last: a dog pulled earlier in the same cycle is purged straight after.
const PULL_TABLES: PulledTable[] = ['units', 'members', 'dogs', 'sessions', 'corrections', 'deleted_dogs'];
const FK_VIOLATION = '23503';
const NOTICES_KEY = 'notices';
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

/** Remove a dog deleted forever elsewhere: its rows here, and every unsent change that refers to them. */
export async function purgeDog(db: ImprintDB, dogId: string): Promise<void> {
  await db.transaction('rw', [db.dogs, db.sessions, db.corrections, db.outbox], async () => {
    const sessionIds = new Set<string>(await db.sessions.where('dog_id').equals(dogId).primaryKeys());
    await db.corrections.where('session_id').anyOf([...sessionIds]).delete();
    await db.sessions.where('dog_id').equals(dogId).delete();
    await db.dogs.delete(dogId);
    await db.outbox
      .filter((i) =>
        (i.table === 'dogs' && i.row.id === dogId) ||
        (i.table === 'sessions' && (i.row.dog_id === dogId || sessionIds.has(i.row.id))) ||
        (i.table === 'corrections' && sessionIds.has(i.row.session_id as string)))
      .delete();
  });
}

/**
 * An insert that failed its foreign key because the dog (or session) it points at was
 * deleted forever on the server. Not so when that parent is itself still in the outbox:
 * then it is a knock-on of our own rejected change, and stays "rejected" for the user to see.
 */
async function lostItsParent(db: ImprintDB, item: OutboxItem): Promise<boolean> {
  if (item.op !== 'insert' || (item.table !== 'sessions' && item.table !== 'corrections')) return false;
  const sessionId = item.table === 'corrections' ? (item.row.session_id as string) : item.row.id;
  const dogId = item.table === 'sessions'
    ? (item.row.dog_id as string)
    : (await db.sessions.get(sessionId))?.dog_id;
  if (!dogId) return false;
  const unsentParent = await db.outbox
    .filter((o) => o.seq !== item.seq && o.op === 'insert' &&
      ((o.table === 'dogs' && o.row.id === dogId) || (o.table === 'sessions' && o.row.id === sessionId)))
    .count();
  return unsentParent === 0;
}

/** Drop the failed insert and everything queued behind it for the same record, and note it for the user. */
async function discard(db: ImprintDB, item: OutboxItem): Promise<number[]> {
  return db.transaction('rw', db.outbox, db.meta, async () => {
    const gone = await db.outbox
      .filter((o) => o.row.id === item.row.id || (o.table === 'corrections' && o.row.session_id === item.row.id))
      .primaryKeys();
    await db.outbox.bulkDelete(gone);
    const notices = new Set(((await db.meta.get(NOTICES_KEY))?.value as string[] | undefined) ?? []);
    notices.add(item.table === 'sessions'
      ? 'A session for a deleted dog was discarded.'
      : 'A correction for a deleted dog was discarded.');
    await db.meta.put({ key: NOTICES_KEY, value: [...notices] });
    return gone;
  });
}

/** Messages the user has not seen yet. Reading clears them, so each shows once. */
export async function takeNotices(db: ImprintDB): Promise<string[]> {
  return db.transaction('rw', db.meta, async () => {
    const notices = ((await db.meta.get(NOTICES_KEY))?.value as string[] | undefined) ?? [];
    if (notices.length) await db.meta.delete(NOTICES_KEY);
    return notices;
  });
}

export async function pushOutbox(d: SyncDeps) {
  const items = await d.db.outbox.where('status').equals('pending').sortBy('seq');
  let pushed = 0, rejected = 0;
  const discarded = new Set<number>();
  for (const item of items) {
    if (discarded.has(item.seq!)) continue; // removed along with a failed parent insert
    const { error } = await send(d, item);
    if (!error) {
      await d.db.outbox.delete(item.seq!);
      pushed++;
    } else if (error.code === FK_VIOLATION && await lostItsParent(d.db, item)) {
      for (const seq of await discard(d.db, item)) discarded.add(seq);
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
    if (table === 'deleted_dogs') {
      for (const r of rows) await purgeDog(d.db, r.dog_id as string);
    } else {
      const fresh = rows.filter((r) => !pendingIds.has(r.id as string));
      await d.db.table(table).bulkPut(fresh);
    }
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

/**
 * Sync now, then again on every Realtime change, every `intervalMs`, and whenever the browser
 * comes back online. Returns a function that stops it all.
 */
export function startSyncLoop(d: SyncDeps, client: SupabaseClient, intervalMs = 30_000): () => void {
  let busy = false;
  const run = async () => {
    if (busy || !navigator.onLine) return;
    busy = true;
    try { await syncOnce(d); } catch { /* retried on the next tick */ } finally { busy = false; }
  };
  const channel = client.channel(`unit-${d.unitId}`);
  for (const table of ['dogs', 'members', 'sessions', 'corrections', 'deleted_dogs']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `unit_id=eq.${d.unitId}` }, run);
  }
  channel.subscribe();
  window.addEventListener('online', run);
  const timer = setInterval(run, intervalMs);
  void run();
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', run);
    void client.removeChannel(channel);
  };
}
