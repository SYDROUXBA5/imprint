import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB, ME_KEY } from '../../src/data/db';
import { demoRole } from '../../src/dev/demoMode';
import { DEMO_INVITE_CODE, DEMO_UNIT_NAME, seedDemo } from '../../src/dev/demoSeed';
import { needsClockCheck, overlappingSessionIds } from '../../src/domain/flags';
import { isValidInviteCode } from '../../src/domain/inviteCode';
import { IMPRINT_TARGET_S, isImprinted, isRunning, latestCorrection, odourTotal } from '../../src/domain/totals';
import type { Member } from '../../src/domain/types';

const NOW = new Date(2026, 9, 9, 12, 0, 0);
let db: ImprintDB;

beforeEach(async () => {
  db = new ImprintDB('imprint-demo-test');
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

async function load() {
  const [dogs, sessions, corrections, members] = await Promise.all([
    db.dogs.toArray(), db.sessions.toArray(), db.corrections.toArray(), db.members.toArray(),
  ]);
  const dogId = (name: string) => dogs.find((d) => d.name === name)!.id;
  return { dogs, sessions, corrections, members, dogId };
}

describe('demo seed', () => {
  it('creates the unit, two trainers, three handlers, four active dogs and one archived dog', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const { dogs, members } = await load();
    const unit = await db.units.toCollection().first();
    expect(unit?.name).toBe(DEMO_UNIT_NAME);
    expect(isValidInviteCode(DEMO_INVITE_CODE)).toBe(true);
    expect(unit?.invite_code).toBe(DEMO_INVITE_CODE);
    expect(members.filter((m) => m.role === 'trainer')).toHaveLength(2);
    expect(members.filter((m) => m.role === 'handler')).toHaveLength(3);
    expect(dogs.filter((d) => d.archived_at === null)).toHaveLength(4);
    expect(dogs.filter((d) => d.archived_at !== null)).toHaveLength(1);
  });

  it('signs in as the trainer or the handler that was asked for', async () => {
    const trainer = await seedDemo('trainer', { db, now: NOW });
    expect(trainer.role).toBe('trainer');
    expect(((await db.meta.get(ME_KEY))?.value as Member).id).toBe(trainer.id);
    const handler = await seedDemo('handler', { db, now: NOW });
    expect(handler.role).toBe('handler');
    expect(((await db.meta.get(ME_KEY))?.value as Member).id).toBe(handler.id);
    expect(await db.members.count()).toBe(5);
  });

  it('has one fully imprinted odour and several part-way', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const { sessions, corrections, dogId } = await load();
    const total = (dog: string, odour: string) => odourTotal(sessions, corrections, dogId(dog), odour);
    expect(total('Juno', 'cocaine')).toBeGreaterThanOrEqual(IMPRINT_TARGET_S);
    expect(total('Juno', 'tnt')).toBe(12 * 60 + 30);
    expect(total('Juno', 'heroin')).toBe(41 * 60 + 5);
    expect(total('Bramble', 'cannabis')).toBe(74 * 60 + 20);
    const imprinted = new Set(
      sessions
        .filter((s) => isImprinted(odourTotal(sessions, corrections, s.dog_id, s.odour_id)))
        .map((s) => `${s.dog_id}/${s.odour_id}`),
    );
    expect(imprinted.size).toBe(1);
  });

  it('has manual sessions, one voided and one corrected session with reasons, and one overlapping pair', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const { sessions, corrections } = await load();
    expect(sessions.filter((s) => s.kind === 'manual').length).toBeGreaterThanOrEqual(3);
    expect(corrections.filter((c) => c.void)).toHaveLength(1);
    expect(corrections.filter((c) => !c.void)).toHaveLength(1);
    for (const c of corrections) expect(c.reason.length).toBeGreaterThan(10);
    const live = sessions.filter((s) => !latestCorrection(s.id, corrections)?.void);
    expect(overlappingSessionIds(live, NOW.getTime()).size).toBe(2);
    expect(sessions.filter(needsClockCheck)).toHaveLength(1);
  });

  it('has exactly one running session, and it belongs to a handler who is not the one signed in', async () => {
    for (const role of ['trainer', 'handler'] as const) {
      const me = await seedDemo(role, { db, now: NOW });
      const { sessions, corrections } = await load();
      const running = sessions.filter((s) => isRunning(s, corrections));
      expect(running).toHaveLength(1);
      expect(running[0].handler_id).not.toBe(me.id);
      expect(Date.parse(running[0].started_at!)).toBeLessThan(NOW.getTime());
    }
  });

  it('keeps every row consistent with its dog, handler and session', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const { dogs, sessions, corrections, members } = await load();
    const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    expect(ids(sessions).size).toBe(sessions.length);
    for (const s of sessions) {
      expect(ids(dogs).has(s.dog_id)).toBe(true);
      expect(ids(members).has(s.handler_id)).toBe(true);
      if (s.kind === 'timed' && s.ended_at) {
        expect((Date.parse(s.ended_at) - Date.parse(s.started_at!)) / 1000).toBe(s.duration_s);
      }
    }
    for (const c of corrections) {
      expect(ids(sessions).has(c.session_id)).toBe(true);
      expect(members.find((m) => m.id === c.trainer_id)?.role).toBe('trainer');
    }
  });

  it('wipes what was there before, and leaves nothing waiting to sync', async () => {
    await db.dogs.add({
      id: 'old', unit_id: 'x', name: 'Leftover', created_by: 'x', created_at: NOW.toISOString(), archived_at: null,
    });
    await db.outbox.add({ table: 'dogs', op: 'insert', row: { id: 'old' }, created_at: NOW.toISOString(), status: 'pending' });
    await seedDemo('handler', { db, now: NOW });
    expect((await db.dogs.toArray()).some((d) => d.id === 'old')).toBe(false);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('demoRole', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('reads ?demo= from the query before the hash, and ignores anything else', () => {
    window.history.replaceState(null, '', '/?demo=trainer#/');
    expect(demoRole()).toBe('trainer');
    window.history.replaceState(null, '', '/?demo=handler#/dog/x');
    expect(demoRole()).toBe('handler');
    window.history.replaceState(null, '', '/?demo=admin#/');
    expect(demoRole()).toBeNull();
    window.history.replaceState(null, '', '/#/?demo=trainer');
    expect(demoRole()).toBeNull();
  });
});
