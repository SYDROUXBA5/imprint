// Dev-only: seeds the local database so the screens can be looked at without a Supabase project.
// Reached only through a guarded dynamic import in main.tsx; never part of a production build.
import { db as appDb, ME_KEY, type ImprintDB } from '../data/db';
import { localDate } from '../domain/format';
import { defaultCatalogueRows, teamOdourId } from '../domain/odours';
import type {
  BreedId, Correction, Dog, Member, Odour, OdourCategory, Purpose, Role, Session, Team, TeamOdour, Unit,
} from '../domain/types';

export const DEMO_UNIT_NAME = 'Demo K9 Unit';
export const DEMO_INVITE_CODE = 'PAWS42';

interface Options { db?: ImprintDB; now?: Date }

/** Empty the local database, fill it with the demo unit and sign in as a trainer or a handler. */
export async function seedDemo(role: Role, { db = appDb, now = new Date() }: Options = {}): Promise<Member> {
  const data = buildDemoData(now);
  const me = data.members.find((m) => m.id === (role === 'trainer' ? 'demo-t1' : 'demo-h1'))!;
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await db.units.add(data.unit);
    await db.members.bulkAdd(data.members);
    await db.teams.bulkAdd(data.teams);
    await db.odour_categories.bulkAdd(data.categories);
    await db.odours.bulkAdd(data.odours);
    await db.team_odours.bulkAdd(data.teamOdours);
    await db.dogs.bulkAdd(data.dogs);
    await db.sessions.bulkAdd(data.sessions);
    await db.corrections.bulkAdd(data.corrections);
    await db.meta.put({ key: ME_KEY, value: me });
  });
  return me;
}

/** What main.tsx calls: no request may leave the page, then seed. */
export async function startDemo(role: Role): Promise<void> {
  blockOffOriginFetch();
  await seedDemo(role);
  document.title = `Imprint (demo: ${role})`;
}

/** The sync loop is not started in demo mode; this makes sure nothing else can reach a server either. */
function blockOffOriginFetch() {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin !== window.location.origin) {
      return Promise.reject(new TypeError(`Demo mode: network is off (${url.origin})`));
    }
    return real(input, init);
  };
}

export function buildDemoData(now: Date) {
  const iso = (d: Date) => d.toISOString();
  /** A calendar day `n` days ago at hh:mm local time. */
  const day = (n: number, hh: number, mm = 0) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, hh, mm);
  const minsAgo = (n: number) => new Date(now.getTime() - n * 60_000);
  const unitId = 'demo-unit';

  const unit: Unit = { id: unitId, name: DEMO_UNIT_NAME, invite_code: DEMO_INVITE_CODE, created_at: iso(day(40, 9)) };

  const member = (id: string, name: string, role: Role): Member => ({
    id, unit_id: unitId, user_id: `demo-user-${id}`, name, role, joined_at: iso(day(40, 9, 5)), removed_at: null,
  });
  const members: Member[] = [
    member('demo-t1', 'Sam Rivera', 'trainer'),
    member('demo-t2', 'Priya Nair', 'trainer'),
    member('demo-h1', 'Jess Okafor', 'handler'),
    member('demo-h2', 'Tom Lindqvist', 'handler'),
    member('demo-h3', 'Ana Souza', 'handler'),
  ];

  // The default catalogue plus one custom category with one custom odour. Odour ids are the readable
  // slugs ('cocaine', 'c4-rdx'), category ids 'cat-<slug>': the local store takes any string.
  const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const { categories, odours } = defaultCatalogueRows(unitId, iso(day(40, 9)),
    (kind, name) => (kind === 'category' ? `cat-${slug(name)}` : slug(name)));
  categories.push({
    id: 'cat-currency', unit_id: unitId, name: 'Currency', sort: categories.length + 1, created_at: iso(day(12, 11)), archived_at: null,
  } satisfies OdourCategory);
  odours.push({
    id: 'banknotes', unit_id: unitId, category_id: 'cat-currency', name: 'Banknotes', created_at: iso(day(12, 11)), archived_at: null,
  } satisfies Odour, {
    // Archived, so the Odours screen has an Archived section (with Restore) to show.
    id: 'counterfeit-ink', unit_id: unitId, category_id: 'cat-currency', name: 'Counterfeit ink', created_at: iso(day(12, 11, 5)),
    archived_at: iso(day(5, 15)),
  } satisfies Odour);

  const team = (id: string, name: string, created: Date, archived: Date | null = null): Team => ({
    id, unit_id: unitId, name, created_by: 'demo-t1', created_at: iso(created), archived_at: archived ? iso(archived) : null,
  });
  const teams: Team[] = [
    team('demo-team-detection', 'Detection', day(40, 9, 30)),
    team('demo-team-customs', 'Customs', day(30, 9, 30)),
    team('demo-team-2025', 'Training 2025', day(40, 9, 40), day(15, 17)),
  ];
  // Each team trains on its own odours: Detection on narcotics and explosives, Customs on a few narcotics,
  // the custom Banknotes and the bed bugs, the archived team on cocaine only.
  const inCategory = (category: string) => odours.filter((o) => o.category_id === category).map((o) => o.id);
  const picks: Record<string, string[]> = {
    'demo-team-detection': [...inCategory('cat-narcotics'), ...inCategory('cat-explosives')],
    'demo-team-customs': ['cocaine', 'cannabis', 'fentanyl', 'banknotes', 'live-bed-bugs', 'viable-eggs'],
    'demo-team-2025': ['cocaine'],
  };
  const teamOdours: TeamOdour[] = Object.entries(picks).flatMap(([teamId, ids]) =>
    ids.map((odourId) => ({ id: teamOdourId(teamId, odourId), team_id: teamId, odour_id: odourId, unit_id: unitId, selected: true })));

  const dog = (
    id: string, name: string, teamId: string, breed: BreedId, purpose: Purpose, created: Date, archived: Date | null = null,
  ): Dog => ({
    id, unit_id: unitId, team_id: teamId, name, breed, purpose, created_by: 'demo-t1', created_at: iso(created),
    archived_at: archived ? iso(archived) : null,
  });
  const dogs: Dog[] = [
    dog('demo-juno', 'Juno', 'demo-team-detection', 'malinois', 'dual', day(35, 10)),
    dog('demo-bramble', 'Bramble', 'demo-team-detection', 'springer-spaniel', 'single', day(30, 10)),
    dog('demo-kestrel', 'Kestrel', 'demo-team-detection', 'german-shepherd', 'dual', day(20, 10)),
    dog('demo-moss', 'Moss', 'demo-team-customs', 'labrador', 'single', day(3, 10)),
    dog('demo-tilly', 'Tilly', 'demo-team-customs', 'golden-retriever', 'single', day(40, 10), day(9, 16)),
    dog('demo-scout', 'Scout', 'demo-team-2025', 'bloodhound', 'single', day(40, 10, 30)),
  ];

  const sessions: Session[] = [];
  const base = (id: string, dogId: string, odourId: string, handlerId: string) => ({
    id: `demo-s-${id}`, unit_id: unitId, dog_id: dogId, odour_id: odourId, handler_id: handlerId,
  });
  /** A finished timer run. `clockOffsetS` is how far the phone's clock was from the server's. */
  const timed = (
    id: string, dogId: string, odourId: string, handlerId: string,
    start: Date, durationS: number, clockOffsetS = 1,
  ) => {
    const end = new Date(start.getTime() + durationS * 1000);
    sessions.push({
      ...base(id, dogId, odourId, handlerId), kind: 'timed', session_date: localDate(start),
      started_at: iso(start), ended_at: iso(end), duration_s: durationS,
      client_clock_offset_s: clockOffsetS, server_received_at: iso(new Date(end.getTime() + 2000)),
    });
  };
  /** A session typed in after the fact: a date and whole minutes. */
  const manual = (id: string, dogId: string, odourId: string, handlerId: string, daysAgo: number, minutes: number) => {
    sessions.push({
      ...base(id, dogId, odourId, handlerId), kind: 'manual', session_date: localDate(day(daysAgo, 12)),
      started_at: null, ended_at: null, duration_s: minutes * 60,
      client_clock_offset_s: null, server_received_at: iso(day(daysAgo, 12, 5)),
    });
  };

  const [t1, t2] = ['demo-t1', 'demo-t2'];
  const [jess, tom, ana] = ['demo-h1', 'demo-h2', 'demo-h3'];

  // Juno: imprinted on cocaine (78:40), heroin part-way (41:05), TNT just begun (12:30).
  timed('j1', 'demo-juno', 'cocaine', jess, day(14, 14), 20 * 60);
  timed('j2', 'demo-juno', 'cocaine', tom, day(12, 10, 30), 15 * 60 + 10);
  manual('j3', 'demo-juno', 'cocaine', jess, 10, 10);
  timed('j4', 'demo-juno', 'cocaine', jess, day(8, 14), 46 * 60 + 12); // timer left running; corrected to 12:00
  timed('j5', 'demo-juno', 'cocaine', ana, day(6, 9, 15), 14 * 60, 21 * 60); // phone clock 21 min out
  timed('j6', 'demo-juno', 'cocaine', jess, day(2, 16), 7 * 60 + 30); // takes the total past 75:00
  timed('j7', 'demo-juno', 'heroin', tom, day(9, 11), 15 * 60);
  timed('j8', 'demo-juno', 'heroin', tom, day(7, 11, 30), 12 * 60 + 5);
  manual('j9', 'demo-juno', 'heroin', jess, 4, 14);
  timed('j10', 'demo-juno', 'tnt', ana, day(1, 15, 20), 12 * 60 + 30);

  // Bramble: cannabis 40 seconds short of imprinted (74:20), a voided run, and two overlapping runs.
  timed('b1', 'demo-bramble', 'cannabis', jess, day(13, 9, 30), 25 * 60);
  timed('b2', 'demo-bramble', 'cannabis', jess, day(11, 9, 30), 20 * 60 + 20);
  manual('b3', 'demo-bramble', 'cannabis', tom, 5, 15);
  timed('b4', 'demo-bramble', 'cannabis', tom, day(2, 10), 14 * 60); // overlaps b5 (two phones, both offline)
  timed('b5', 'demo-bramble', 'cocaine', jess, day(2, 10, 5), 9 * 60);
  timed('b6', 'demo-bramble', 'methamphetamine', ana, day(4, 13), 12 * 60 + 30);
  timed('b7', 'demo-bramble', 'methamphetamine', tom, day(4, 13, 30), 9 * 60 + 10); // voided

  // Kestrel: TNT part-way (41:05) and a timer running right now on another handler's phone.
  timed('k1', 'demo-kestrel', 'tnt', ana, day(8, 11), 20 * 60);
  timed('k2', 'demo-kestrel', 'tnt', tom, day(5, 15), 11 * 60 + 5);
  manual('k3', 'demo-kestrel', 'tnt', jess, 2, 10);
  timed('k4', 'demo-kestrel', 'c4-rdx', tom, day(1, 14), 15 * 60);
  const runStart = minsAgo(6);
  sessions.push({
    ...base('k5', 'demo-kestrel', 'c4-rdx', tom), kind: 'timed', session_date: localDate(runStart),
    started_at: iso(runStart), ended_at: null, duration_s: null,
    client_clock_offset_s: 1, server_received_at: iso(new Date(runStart.getTime() + 2000)),
  });

  // Moss: new, one run this morning, then a custom odour and the bed bugs.
  timed('m1', 'demo-moss', 'cocaine', jess, minsAgo(90), 12 * 60 + 30);
  manual('m2', 'demo-moss', 'banknotes', jess, 1, 20);
  manual('m3', 'demo-moss', 'live-bed-bugs', tom, 2, 15);
  manual('m4', 'demo-moss', 'heroin', tom, 2, 10); // Moss was moved here from Detection; Customs does not train on heroin: "(not in current list)" in the log

  // Scout: in the archived team.
  timed('s1', 'demo-scout', 'cocaine', tom, day(20, 10), 18 * 60);

  // Tilly: archived.
  timed('t1', 'demo-tilly', 'cocaine', tom, day(28, 10), 20 * 60);
  timed('t2', 'demo-tilly', 'cocaine', ana, day(26, 10), 13 * 60 + 20);

  const correction = (
    id: string, sessionId: string, trainerId: string, created: Date, reason: string, newDurationS: number | null,
  ): Correction => ({
    id: `demo-c-${id}`, session_id: `demo-s-${sessionId}`, unit_id: unitId, trainer_id: trainerId,
    void: newDurationS === null, new_duration_s: newDurationS, reason, created_at: iso(created),
  });
  const corrections: Correction[] = [
    correction('1', 'j4', t1, day(7, 9), 'Handler forgot to stop the timer. Real work was 12 minutes, confirmed with Jess.', 12 * 60),
    correction('2', 'b7', t2, day(3, 9), 'Timer was started on the wrong dog. That work was on Kestrel.', null),
  ];

  return { unit, members, teams, categories, odours, teamOdours, dogs, sessions, corrections };
}
