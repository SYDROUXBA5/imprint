import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImprintDB } from '../../src/data/db';
import type { RemoteStore } from '../../src/data/remote';
import { startSyncLoop } from '../../src/data/sync';

type Handler = () => void;
function fakeClient() {
  const handlers: { table: string; filter: string; cb: Handler }[] = [];
  const channel = {
    on: vi.fn((_type: string, cfg: { table: string; filter: string }, cb: Handler) => {
      handlers.push({ table: cfg.table, filter: cfg.filter, cb });
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => 'ok') };
  return { client: client as unknown as SupabaseClient, raw: client, channel, handlers };
}

let db: ImprintDB;
let changesSince: ReturnType<typeof vi.fn>;
let remote: RemoteStore;
let online = true;

beforeEach(() => {
  // Only the interval is faked: fake-indexeddb needs the real setTimeout/setImmediate.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  db = new ImprintDB(`loop-${Math.random()}`);
  changesSince = vi.fn(async () => ({ rows: [] }));
  remote = { insert: vi.fn(async () => ({})), update: vi.fn(async () => ({})), changesSince } as unknown as RemoteStore;
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 40)); // let Dexie/IDB settle
const cycles = (n: number) => vi.waitFor(() => expect(changesSince).toHaveBeenCalledTimes(n * pullsPerCycle));
const pullsPerCycle = 6; // units, members, dogs, sessions, corrections, deleted_dogs
const deps = () => ({ db, remote, unitId: 'u1' });

describe('startSyncLoop', () => {
  it('subscribes to every synced table including tombstones, filtered to the unit', () => {
    const f = fakeClient();
    const stop = startSyncLoop(deps(), f.client);
    expect(f.raw.channel).toHaveBeenCalledWith('unit-u1');
    expect(f.handlers.map((h) => h.table).sort()).toEqual(['corrections', 'deleted_dogs', 'dogs', 'members', 'sessions']);
    expect(new Set(f.handlers.map((h) => h.filter))).toEqual(new Set(['unit_id=eq.u1']));
    expect(f.channel.subscribe).toHaveBeenCalledTimes(1);
    stop();
  });

  it('syncs once straight away, then on every tick', async () => {
    const stop = startSyncLoop(deps(), fakeClient().client, 30_000);
    await cycles(1);
    vi.advanceTimersByTime(30_000);
    await cycles(2);
    stop();
  });

  it('syncs when a realtime change arrives', async () => {
    const f = fakeClient();
    const stop = startSyncLoop(deps(), f.client);
    await cycles(1);
    f.handlers.find((h) => h.table === 'deleted_dogs')!.cb();
    await cycles(2);
    stop();
  });

  it('does nothing while offline, and syncs when the browser comes back online', async () => {
    online = false;
    const stop = startSyncLoop(deps(), fakeClient().client);
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(changesSince).not.toHaveBeenCalled();
    online = true;
    window.dispatchEvent(new Event('online'));
    await cycles(1);
    stop();
  });

  it('never runs two syncs at once', async () => {
    let release!: () => void;
    changesSince.mockImplementationOnce(() => new Promise((res) => { release = () => res({ rows: [] }); }));
    const f = fakeClient();
    const stop = startSyncLoop(deps(), f.client);
    await vi.waitFor(() => expect(changesSince).toHaveBeenCalledTimes(1));
    f.handlers[0].cb(); // arrives mid-sync
    vi.advanceTimersByTime(30_000); // and so does a tick
    await flush();
    expect(changesSince).toHaveBeenCalledTimes(1); // still only the first, stuck one
    release();
    await vi.waitFor(() => expect(changesSince).toHaveBeenCalledTimes(pullsPerCycle)); // that cycle finishes
    stop();
  });

  it('survives a failing sync and tries again on the next tick', async () => {
    changesSince.mockRejectedValueOnce(new Error('Failed to fetch'));
    const stop = startSyncLoop(deps(), fakeClient().client, 30_000);
    await vi.waitFor(() => expect(changesSince).toHaveBeenCalledTimes(1));
    await flush();
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(changesSince).toHaveBeenCalledTimes(1 + pullsPerCycle));
    stop();
  });

  it('the stop function clears the timer, the online listener and the channel', async () => {
    const f = fakeClient();
    const stop = startSyncLoop(deps(), f.client, 30_000);
    await cycles(1);
    stop();
    changesSince.mockClear();
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(changesSince).not.toHaveBeenCalled();
    expect(f.raw.removeChannel).toHaveBeenCalledWith(f.channel);
  });
});
