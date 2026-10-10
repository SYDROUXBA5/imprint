import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB, ME_KEY } from '../../src/data/db';
import { demoRole } from '../../src/dev/demoMode';
import { DEMO_INVITE_CODE, DEMO_UNIT_NAME, seedDemo } from '../../src/dev/demoSeed';
import { needsClockCheck, overlappingSessionIds } from '../../src/domain/flags';
import { isValidInviteCode } from '../../src/domain/inviteCode';
import { IMPRINT_TARGET_S, isImprinted, isRunning, latestCorrection, odourTotal } from '../../src/domain/totals';
import { isBreedId, isPurpose } from '../../src/domain/breeds';
import { DEFAULT_CATALOGUE, isInTeamList } from '../../src/domain/odours';
import type { Member } from '../../src/domain/types';
import { dogRow, team } from '../fixtures';

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
  it('creates the unit, two trainers, three handlers, five dogs that are not archived and one that is', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const { dogs, members } = await load();
    const unit = await db.units.toCollection().first();
    expect(unit?.name).toBe(DEMO_UNIT_NAME);
    expect(isValidInviteCode(DEMO_INVITE_CODE)).toBe(true);
    expect(unit?.invite_code).toBe(DEMO_INVITE_CODE);
    expect(members.filter((m) => m.role === 'trainer')).toHaveLength(2);
    expect(members.filter((m) => m.role === 'handler')).toHaveLength(3);
    expect(dogs.filter((d) => d.archived_at === null)).toHaveLength(5);
    expect(dogs.filter((d) => d.archived_at !== null)).toHaveLength(1);
  });

  it('has three teams, one of them archived, and every dog is in one with a breed and a purpose', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const { dogs } = await load();
    const teams = await db.teams.toArray();
    expect(teams).toHaveLength(3);
    expect(teams.filter((t) => t.archived_at !== null)).toHaveLength(1);
    expect(new Set(teams.map((t) => t.name)).size).toBe(3);
    for (const d of dogs) {
      expect(teams.some((t) => t.id === d.team_id), d.name).toBe(true);
      expect(isBreedId(d.breed), d.name).toBe(true);
      expect(isPurpose(d.purpose), d.name).toBe(true);
    }
    expect(new Set(dogs.map((d) => d.breed)).size).toBeGreaterThan(3);
    expect(new Set(dogs.map((d) => d.purpose))).toEqual(new Set(['single', 'dual']));
    // the archived team holds a dog; the active ones hold several between them, an archived dog among them
    const archivedTeam = teams.find((t) => t.archived_at !== null)!;
    expect(dogs.filter((d) => d.team_id === archivedTeam.id).length).toBeGreaterThan(0);
  });

  it('has the four default categories, a custom category with a custom odour, and a different list for each team', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const categories = (await db.odour_categories.toArray()).sort((a, b) => a.sort - b.sort);
    const odours = await db.odours.toArray();
    expect(categories.slice(0, 4).map((c) => c.name)).toEqual(DEFAULT_CATALOGUE.map((c) => c.name));
    const custom = categories.slice(4);
    expect(custom.map((c) => c.name)).toEqual(['Currency']);
    expect(odours.filter((o) => o.category_id === custom[0].id && o.archived_at === null).map((o) => o.name)).toEqual(['Banknotes']);
    // One archived odour, so the Odours screen has an Archived section to show; nothing else is archived.
    expect(odours.filter((o) => o.archived_at !== null).map((o) => o.name)).toEqual(['Counterfeit ink']);
    expect(odours).toHaveLength(DEFAULT_CATALOGUE.reduce((n, c) => n + c.odours.length, 0) + 2);
    expect(categories.every((c) => c.archived_at === null)).toBe(true);
    const teamOdours = await db.team_odours.toArray();
    const listOf = (teamId: string) => teamOdours.filter((t) => t.team_id === teamId && t.selected).map((t) => t.odour_id).sort().join(',');
    const lists = new Set((await db.teams.toArray()).map((t) => listOf(t.id)));
    expect(lists.size).toBe(3);
    expect([...lists].every((l) => l.length > 0)).toBe(true);
  });

  it('logs every session on an odour of the catalogue, all but one on an odour the dog\'s team trains on', async () => {
    await seedDemo('trainer', { db, now: NOW });
    const { dogs, sessions } = await load();
    const catalogue = { categories: await db.odour_categories.toArray(), odours: await db.odours.toArray(), teamOdours: await db.team_odours.toArray() };
    const unlisted: string[] = [];
    for (const s of sessions) {
      const dog = dogs.find((d) => d.id === s.dog_id)!;
      expect(catalogue.odours.some((o) => o.id === s.odour_id), `${dog.name} / ${s.odour_id}`).toBe(true);
      if (!isInTeamList(dog.team_id, s.odour_id, catalogue)) unlisted.push(`${dog.name} / ${s.odour_id}`);
    }
    // Moss did some heroin work, then moved to Customs, which does not train on it: the log shows "(not in current list)".
    expect(unlisted).toEqual(['Moss / heroin']);
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
    await db.dogs.add(dogRow('old', 'Leftover', { unit_id: 'x', team_id: 'old-team' }));
    await db.teams.add(team('old-team', 'Leftover team', null, 'x'));
    await db.odours.add({ id: 'old-odour', unit_id: 'x', category_id: 'x', name: 'Leftover', created_at: '', archived_at: null });
    await db.outbox.add({ table: 'dogs', op: 'insert', row: { id: 'old' }, created_at: NOW.toISOString(), status: 'pending' });
    await seedDemo('handler', { db, now: NOW });
    expect((await db.dogs.toArray()).some((d) => d.id === 'old')).toBe(false);
    expect((await db.teams.toArray()).some((t) => t.id === 'old-team')).toBe(false);
    expect((await db.odours.toArray()).some((o) => o.id === 'old-odour')).toBe(false);
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
