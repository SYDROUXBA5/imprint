# Imprint Tracker — Implementation Plan

> **For the agent executing this plan:** work task by task, in order. Each task
> ends with its tests green and a commit. Do not skip the "run and watch it fail"
> steps. Spec: `docs/superpowers/specs/2026-10-03-imprint-tracker-design.md`.
> Visual reference: `docs/design/reference-4c-trainers-field-guide.png`.

**Goal:** An installable web app where a K9 unit's handlers time odour-imprinting
sessions per dog and odour, see progress toward 75:00, and keep a traceable,
offline-capable shared log.

**Architecture:** React PWA. Every write goes to IndexedDB (Dexie) plus an outbox
first. A sync engine pushes the outbox to Supabase and pulls changes back.
Postgres Row Level Security enforces roles. Domain rules (totals, corrections,
flags, the celebration trigger) are pure TypeScript functions with no I/O.

**Tech stack:** Vite, React 18, TypeScript, react-router-dom (HashRouter),
Dexie + dexie-react-hooks, @supabase/supabase-js, vite-plugin-pwa,
@fontsource/nunito, Vitest + Testing Library + fake-indexeddb,
@electric-sql/pglite (database/RLS tests without Docker), Playwright.

**Environment facts (checked 2026-10-03):** Node 22.22, npm 10.9, `gh` installed.
No Docker and no Supabase CLI, so database tests run in PGlite (in-process Postgres).

---

## Prerequisites (Rémi, before Phase 3)

These need Rémi's own accounts. The agent cannot create them.

1. Create a Supabase account and a project named `imprint`, region **Frankfurt
   (eu-central-1)**, on the free plan.
2. In **Authentication → Providers → Email**, switch **Confirm email** off
   (one private unit; this saves handlers from needing their inbox to join).
3. From **Project Settings → API**, copy the **Project URL** and the
   **anon public key** into `.env.local` (template in Task 1).
4. For the Playwright tests only (Task 22): put the **service_role key** in
   `.env.test.local`. This file is git-ignored. Never commit it or paste it in chat.

Phases 1 and 2 need none of this.

---

## File map

```
imprint/
  index.html  package.json  tsconfig.json  vite.config.ts  vitest.config.ts
  playwright.config.ts  .env.example  .gitignore
  supabase/migrations/0001_init.sql        schema, RLS, triggers, RPCs
  supabase/migrations/0002_realtime.sql    Supabase-only (publication)
  public/icon.svg
  src/
    main.tsx  App.tsx
    domain/odours.ts        fixed odour list
    domain/types.ts         row types
    domain/totals.ts        durations, totals, running, imprinted
    domain/flags.ts         overlap + clock check
    domain/celebration.ts   crossing detection
    domain/format.ts        clock and minute formatting, local date
    domain/inviteCode.ts    normalise + validate codes
    data/db.ts              Dexie schema
    data/repo.ts            local writes (data + outbox in one transaction)
    data/remote.ts          RemoteStore interface + Supabase adapter
    data/sync.ts            push, pull, loop
    data/supabase.ts        client from env
    data/account.ts         sign up/in, create/join unit, team actions
    hooks/useNow.ts  hooks/useMe.ts  hooks/useUnitData.ts
    ui/theme.css
    ui/components/{HeaderBar,Card,PillToggle,ProgressBar,CompassRing,
                   ImprintedStamp,Monogram,SyncBadge,RunningBanner,Sheet}.tsx
    ui/Celebration.tsx  ui/celebration.css
    ui/screens/{WelcomeScreen,DogsScreen,DogScreen,TimerScreen,
                ManualEntrySheet,LogScreen,CorrectionSheet,TeamScreen}.tsx
  tests/
    setup.ts
    domain/*.test.ts
    db/harness.ts  db/rls.test.ts  db/odour-sync.test.ts
    data/repo.test.ts  data/sync.test.ts
    ui/*.test.tsx
    e2e/offline.spec.ts  e2e/seed.ts
  .github/workflows/pages.yml
```

---

# Phase 1 — Project and domain rules (no backend)

### Task 1: Scaffold

**Files:** project root files, `src/main.tsx`, `src/App.tsx`, `tests/setup.ts`

- [ ] **Step 1: Scaffold Vite into a temp folder and move it in** (the repo already has `docs/`)

```bash
cd ~/Documents/CLAUDE/6-app-making/imprint
npm create vite@latest .tmp-vite -- --template react-ts
rsync -a .tmp-vite/ ./ && rm -rf .tmp-vite
```

- [ ] **Step 2: Install dependencies**

```bash
npm install react-router-dom dexie dexie-react-hooks @supabase/supabase-js @fontsource/nunito
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event fake-indexeddb @electric-sql/pglite vite-plugin-pwa @playwright/test
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    env: { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
  },
});
```

- [ ] **Step 4: Create `tests/setup.ts`**

```ts
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Add scripts to `package.json`**

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test"
}
```

- [ ] **Step 6: Create `.env.example` and update `.gitignore`**

`.env.example`:
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Append to `.gitignore`:
```
.env.local
.env.test.local
test-results/
playwright-report/
```

- [ ] **Step 7: Replace `src/App.tsx` with a placeholder**

```tsx
export default function App() {
  return <h1>Imprint</h1>;
}
```

Delete `src/App.css`, `src/index.css`, `src/assets/`, and remove their imports from `src/main.tsx`.

- [ ] **Step 8: Verify**

Run: `npm run build && npx vitest run --passWithNoTests`
Expected: build succeeds; Vitest reports no test files and exits 0.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite React TS app with test tooling"
```

---

### Task 2: Odour list

**Files:** create `src/domain/odours.ts`, test `tests/domain/odours.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ODOURS, odourById, odoursIn } from '../../src/domain/odours';

describe('odours', () => {
  it('has 6 narcotics and 11 explosives', () => {
    expect(odoursIn('narcotics')).toHaveLength(6);
    expect(odoursIn('explosives')).toHaveLength(11);
  });

  it('has unique ids', () => {
    const ids = ODOURS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks odours up by id', () => {
    expect(odourById('mdma')).toEqual({ id: 'mdma', name: 'MDMA', group: 'narcotics' });
    expect(odourById('nope')).toBeUndefined();
  });

  it('keeps the spec order', () => {
    expect(odoursIn('narcotics').map((o) => o.name)).toEqual([
      'Cocaine', 'Heroin', 'Methamphetamine', 'MDMA', 'Cannabis', 'Fentanyl',
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/odours.test.ts`
Expected: FAIL, cannot find module `odours`.

- [ ] **Step 3: Implement `src/domain/odours.ts`**

```ts
export type OdourGroup = 'narcotics' | 'explosives';

export interface Odour {
  id: string;
  name: string;
  group: OdourGroup;
}

export const ODOURS: readonly Odour[] = [
  { id: 'cocaine', name: 'Cocaine', group: 'narcotics' },
  { id: 'heroin', name: 'Heroin', group: 'narcotics' },
  { id: 'methamphetamine', name: 'Methamphetamine', group: 'narcotics' },
  { id: 'mdma', name: 'MDMA', group: 'narcotics' },
  { id: 'cannabis', name: 'Cannabis', group: 'narcotics' },
  { id: 'fentanyl', name: 'Fentanyl', group: 'narcotics' },
  { id: 'tnt', name: 'TNT', group: 'explosives' },
  { id: 'c4-rdx', name: 'C4/RDX', group: 'explosives' },
  { id: 'petn', name: 'PETN', group: 'explosives' },
  { id: 'semtex', name: 'Semtex', group: 'explosives' },
  { id: 'black-powder', name: 'Black powder', group: 'explosives' },
  { id: 'smokeless-powder', name: 'Smokeless powder', group: 'explosives' },
  { id: 'ammonium-nitrate', name: 'Ammonium nitrate', group: 'explosives' },
  { id: 'det-cord', name: 'Det cord', group: 'explosives' },
  { id: 'dynamite', name: 'Dynamite', group: 'explosives' },
  { id: 'tatp', name: 'TATP', group: 'explosives' },
  { id: 'hmtd', name: 'HMTD', group: 'explosives' },
];

export const odoursIn = (group: OdourGroup): Odour[] =>
  ODOURS.filter((o) => o.group === group);

export const odourById = (id: string): Odour | undefined =>
  ODOURS.find((o) => o.id === id);
```

- [ ] **Step 4: Run it and watch it pass.** Run: `npx vitest run tests/domain/odours.test.ts`. Expected: 4 passed.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(domain): fixed odour list"`

---

### Task 3: Row types and totals

**Files:** create `src/domain/types.ts`, `src/domain/totals.ts`; test `tests/domain/totals.test.ts`

- [ ] **Step 1: Create `src/domain/types.ts`** (types only, no test needed)

```ts
export type Role = 'trainer' | 'handler';
export type SessionKind = 'timed' | 'manual';

export interface Unit {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  updated_at?: string;
}

export interface Member {
  id: string;
  unit_id: string;
  user_id: string;
  name: string;
  role: Role;
  joined_at: string;
  removed_at: string | null;
  updated_at?: string;
}

export interface Dog {
  id: string;
  unit_id: string;
  name: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  updated_at?: string;
}

export interface Session {
  id: string;
  unit_id: string;
  dog_id: string;
  odour_id: string;
  handler_id: string;
  kind: SessionKind;
  /** Local calendar date, YYYY-MM-DD. */
  session_date: string;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  client_clock_offset_s: number | null;
  server_received_at: string | null;
  updated_at?: string;
}

export interface Correction {
  id: string;
  session_id: string;
  unit_id: string;
  trainer_id: string;
  void: boolean;
  new_duration_s: number | null;
  reason: string;
  created_at: string;
  updated_at?: string;
}
```

- [ ] **Step 2: Write the failing test `tests/domain/totals.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Correction, Session } from '../../src/domain/types';
import {
  IMPRINT_TARGET_S, currentDuration, isImprinted, isRunning,
  latestCorrection, liveElapsed, odourTotal,
} from '../../src/domain/totals';

const session = (o: Partial<Session> = {}): Session => ({
  id: 's1', unit_id: 'u1', dog_id: 'd1', odour_id: 'mdma', handler_id: 'm1',
  kind: 'timed', session_date: '2026-10-03',
  started_at: '2026-10-03T10:00:00.000Z', ended_at: '2026-10-03T10:10:00.000Z',
  duration_s: 600, client_clock_offset_s: null, server_received_at: null, ...o,
});

const correction = (o: Partial<Correction> = {}): Correction => ({
  id: 'c1', session_id: 's1', unit_id: 'u1', trainer_id: 't1', void: false,
  new_duration_s: 300, reason: 'fix', created_at: '2026-10-03T12:00:00.000Z', ...o,
});

const at = (iso: string) => Date.parse(iso);

describe('totals', () => {
  it('target is 75 minutes', () => {
    expect(IMPRINT_TARGET_S).toBe(4500);
  });

  it('uses the session duration when there is no correction', () => {
    expect(currentDuration(session(), [])).toBe(600);
  });

  it('uses the latest correction by created_at', () => {
    const cs = [
      correction({ id: 'c1', new_duration_s: 300, created_at: '2026-10-03T12:00:00.000Z' }),
      correction({ id: 'c2', new_duration_s: 120, created_at: '2026-10-03T13:00:00.000Z' }),
    ];
    expect(latestCorrection('s1', cs)?.id).toBe('c2');
    expect(currentDuration(session(), cs)).toBe(120);
  });

  it('ignores corrections for other sessions', () => {
    expect(currentDuration(session(), [correction({ session_id: 'other' })])).toBe(600);
  });

  it('counts a voided session as 0', () => {
    expect(currentDuration(session(), [correction({ void: true, new_duration_s: null })])).toBe(0);
  });

  it('a running session stores 0 and has live elapsed time', () => {
    const s = session({ ended_at: null, duration_s: null });
    expect(isRunning(s, [])).toBe(true);
    expect(currentDuration(s, [])).toBe(0);
    expect(liveElapsed(s, [], at('2026-10-03T10:02:05.900Z'))).toBe(125);
  });

  it('a corrected running session is no longer running', () => {
    const s = session({ ended_at: null, duration_s: null });
    const cs = [correction({ new_duration_s: 480 })];
    expect(isRunning(s, cs)).toBe(false);
    expect(liveElapsed(s, cs, at('2026-10-03T13:00:00.000Z'))).toBe(0);
    expect(currentDuration(s, cs)).toBe(480);
  });

  it('manual sessions are never running', () => {
    const s = session({ kind: 'manual', started_at: null, ended_at: null, duration_s: 900 });
    expect(isRunning(s, [])).toBe(false);
    expect(currentDuration(s, [])).toBe(900);
  });

  it('sums only the same dog and odour', () => {
    const sessions = [
      session({ id: 'a', duration_s: 600 }),
      session({ id: 'b', duration_s: 300 }),
      session({ id: 'c', odour_id: 'cocaine', duration_s: 999 }),
      session({ id: 'd', dog_id: 'd2', duration_s: 999 }),
    ];
    expect(odourTotal(sessions, [], 'd1', 'mdma')).toBe(900);
  });

  it('adds live elapsed time only when now is given', () => {
    const sessions = [
      session({ id: 'a', duration_s: 600 }),
      session({ id: 'r', ended_at: null, duration_s: null, started_at: '2026-10-03T11:00:00.000Z' }),
    ];
    expect(odourTotal(sessions, [], 'd1', 'mdma')).toBe(600);
    expect(odourTotal(sessions, [], 'd1', 'mdma', at('2026-10-03T11:01:00.000Z'))).toBe(660);
  });

  it('imprinted at exactly 75:00, not at 74:59', () => {
    expect(isImprinted(4499)).toBe(false);
    expect(isImprinted(4500)).toBe(true);
  });
});
```

- [ ] **Step 3: Run and watch it fail.** Run: `npx vitest run tests/domain/totals.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement `src/domain/totals.ts`**

```ts
import type { Correction, Session } from './types';

export const IMPRINT_TARGET_S = 75 * 60;

export function latestCorrection(sessionId: string, corrections: Correction[]): Correction | undefined {
  let latest: Correction | undefined;
  for (const c of corrections) {
    if (c.session_id !== sessionId) continue;
    if (!latest || c.created_at > latest.created_at) latest = c;
  }
  return latest;
}

export function isRunning(session: Session, corrections: Correction[]): boolean {
  return (
    session.kind === 'timed' &&
    session.started_at !== null &&
    session.ended_at === null &&
    latestCorrection(session.id, corrections) === undefined
  );
}

export function currentDuration(session: Session, corrections: Correction[]): number {
  const c = latestCorrection(session.id, corrections);
  if (c) return c.void ? 0 : (c.new_duration_s ?? 0);
  return session.duration_s ?? 0;
}

export function liveElapsed(session: Session, corrections: Correction[], nowMs: number): number {
  if (!isRunning(session, corrections)) return 0;
  return Math.max(0, Math.floor((nowMs - Date.parse(session.started_at!)) / 1000));
}

export function odourTotal(
  sessions: Session[], corrections: Correction[],
  dogId: string, odourId: string, nowMs?: number,
): number {
  let total = 0;
  for (const s of sessions) {
    if (s.dog_id !== dogId || s.odour_id !== odourId) continue;
    total += currentDuration(s, corrections);
    if (nowMs !== undefined) total += liveElapsed(s, corrections, nowMs);
  }
  return total;
}

export const isImprinted = (totalS: number): boolean => totalS >= IMPRINT_TARGET_S;
```

ISO strings from `toISOString()` compare correctly as strings, which is why `created_at` is compared with `>`.

- [ ] **Step 5: Run and watch it pass.** Expected: 11 passed.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(domain): session durations, corrections, totals"`

---

### Task 4: Flags (overlap, clock check)

**Files:** create `src/domain/flags.ts`; test `tests/domain/flags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/domain/types';
import { CLOCK_CHECK_LIMIT_S, needsClockCheck, overlappingSessionIds } from '../../src/domain/flags';

const timed = (id: string, dog: string, start: string, end: string | null): Session => ({
  id, unit_id: 'u1', dog_id: dog, odour_id: 'mdma', handler_id: 'm1', kind: 'timed',
  session_date: '2026-10-03', started_at: start, ended_at: end,
  duration_s: end ? 60 : null, client_clock_offset_s: null, server_received_at: null,
});

describe('overlap', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');

  it('flags both sessions when time ranges overlap on the same dog', () => {
    const ids = overlappingSessionIds([
      timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z'),
      timed('b', 'd1', '2026-10-03T10:05:00Z', '2026-10-03T10:20:00Z'),
    ], now);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('does not flag touching ranges or different dogs', () => {
    const ids = overlappingSessionIds([
      timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z'),
      timed('b', 'd1', '2026-10-03T10:10:00Z', '2026-10-03T10:20:00Z'),
      timed('c', 'd2', '2026-10-03T10:05:00Z', '2026-10-03T10:08:00Z'),
    ], now);
    expect(ids.size).toBe(0);
  });

  it('treats a running session as lasting until now', () => {
    const ids = overlappingSessionIds([
      timed('a', 'd1', '2026-10-03T11:00:00Z', null),
      timed('b', 'd1', '2026-10-03T11:30:00Z', '2026-10-03T11:40:00Z'),
    ], now);
    expect(ids.size).toBe(2);
  });

  it('ignores manual sessions', () => {
    const manual: Session = { ...timed('m', 'd1', '2026-10-03T10:00:00Z', null), kind: 'manual', started_at: null, duration_s: 600 };
    const ids = overlappingSessionIds([manual, timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z')], now);
    expect(ids.size).toBe(0);
  });
});

describe('clock check', () => {
  it('flags offsets over 10 minutes either way', () => {
    expect(CLOCK_CHECK_LIMIT_S).toBe(600);
    const s = timed('a', 'd1', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z');
    expect(needsClockCheck({ ...s, client_clock_offset_s: 600 })).toBe(false);
    expect(needsClockCheck({ ...s, client_clock_offset_s: 601 })).toBe(true);
    expect(needsClockCheck({ ...s, client_clock_offset_s: -601 })).toBe(true);
    expect(needsClockCheck({ ...s, client_clock_offset_s: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement `src/domain/flags.ts`**

```ts
import type { Session } from './types';

export const CLOCK_CHECK_LIMIT_S = 600;

export const needsClockCheck = (s: Session): boolean =>
  s.client_clock_offset_s !== null && Math.abs(s.client_clock_offset_s) > CLOCK_CHECK_LIMIT_S;

export function overlappingSessionIds(sessions: Session[], nowMs: number): Set<string> {
  const flagged = new Set<string>();
  const byDog = new Map<string, { id: string; start: number; end: number }[]>();
  for (const s of sessions) {
    if (s.kind !== 'timed' || !s.started_at) continue;
    const list = byDog.get(s.dog_id) ?? [];
    list.push({
      id: s.id,
      start: Date.parse(s.started_at),
      end: s.ended_at ? Date.parse(s.ended_at) : nowMs,
    });
    byDog.set(s.dog_id, list);
  }
  for (const list of byDog.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.start < b.end && b.start < a.end) {
          flagged.add(a.id);
          flagged.add(b.id);
        }
      }
    }
  }
  return flagged;
}
```

- [ ] **Step 4: Run and watch it pass.** Expected: 5 passed.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(domain): overlap and clock-check flags"`

---

### Task 5: Celebration trigger, formatting, invite codes

**Files:** create `src/domain/celebration.ts`, `src/domain/format.ts`, `src/domain/inviteCode.ts`; test `tests/domain/small.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { crossedTarget } from '../../src/domain/celebration';
import { formatClock, formatMinutesOfTarget, localDate } from '../../src/domain/format';
import { isValidInviteCode, normalizeInviteCode } from '../../src/domain/inviteCode';

describe('crossedTarget', () => {
  it('fires only on the move from below 4500 to 4500 or more', () => {
    expect(crossedTarget(4499, 4500)).toBe(true);
    expect(crossedTarget(4000, 5000)).toBe(true);
    expect(crossedTarget(4500, 4501)).toBe(false);
    expect(crossedTarget(4000, 4499)).toBe(false);
    expect(crossedTarget(5000, 4000)).toBe(false);
  });
});

describe('format', () => {
  it('formats a clock as m:ss under an hour and h:mm:ss above', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(724)).toBe('12:04');
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('formats progress as whole minutes of 75', () => {
    expect(formatMinutesOfTarget(2520)).toBe('42/75');
    expect(formatMinutesOfTarget(4499)).toBe('74/75');
  });

  it('gives the local calendar date', () => {
    expect(localDate(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
  });
});

describe('invite codes', () => {
  it('normalises case, spaces and dashes', () => {
    expect(normalizeInviteCode(' ab3-k9z ')).toBe('AB3K9Z');
  });

  it('accepts 6 chars from the alphabet and rejects 0, O, 1, I', () => {
    expect(isValidInviteCode('AB3K9Z')).toBe(true);
    expect(isValidInviteCode('AB3K9')).toBe(false);
    expect(isValidInviteCode('AB0K9Z')).toBe(false);
    expect(isValidInviteCode('ABOK9Z')).toBe(false);
    expect(isValidInviteCode('AB1K9Z')).toBe(false);
    expect(isValidInviteCode('ABIK9Z')).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement the three files**

`src/domain/celebration.ts`:
```ts
import { IMPRINT_TARGET_S } from './totals';

export const crossedTarget = (prevS: number, nextS: number): boolean =>
  prevS < IMPRINT_TARGET_S && nextS >= IMPRINT_TARGET_S;
```

`src/domain/format.ts`:
```ts
import { IMPRINT_TARGET_S } from './totals';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export const formatMinutesOfTarget = (totalS: number): string =>
  `${Math.floor(totalS / 60)}/${IMPRINT_TARGET_S / 60}`;

export const localDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
```

`src/domain/inviteCode.ts`:
```ts
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const normalizeInviteCode = (raw: string): string =>
  raw.toUpperCase().replace(/[\s-]/g, '');

export const isValidInviteCode = (code: string): boolean =>
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/.test(code);
```

- [ ] **Step 4: Run and watch it pass.** Run: `npm test`. Expected: all domain tests pass.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(domain): celebration trigger, formatting, invite codes"`

---

# Phase 2 — Database schema and permissions (PGlite, no Supabase account needed)

### Task 6: PGlite harness, and a check that RLS is enforced

**Files:** create `tests/db/harness.ts`, `tests/db/rls.test.ts`

The harness imitates the parts of Supabase the schema relies on: the
`authenticated` role, `auth.users`, and `auth.uid()` read from a setting.

- [ ] **Step 1: Create `tests/db/harness.ts`**

```ts
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const AUTH_STUB = `
  create role authenticated nologin;
  create role anon nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
`;

const GRANTS = `
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`;

export async function freshDb(withSchema = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  if (withSchema) {
    await db.exec(readFileSync('supabase/migrations/0001_init.sql', 'utf8'));
    await db.exec(GRANTS);
  }
  return db;
}

export async function addUser(db: PGlite, id: string): Promise<void> {
  await db.query('insert into auth.users (id) values ($1)', [id]);
}

/** Run fn as a signed-in user, with RLS applied. */
export async function as<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
```

- [ ] **Step 2: Write a spike test proving PGlite enforces RLS**

At the top of `tests/db/rls.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { as, freshDb } from './harness';

describe('PGlite RLS spike', () => {
  it('hides rows from authenticated when no policy allows them', async () => {
    const db = await freshDb(false);
    await db.exec(`
      create table t (id int); insert into t values (1);
      alter table t enable row level security;
      grant select on t to authenticated;
    `);
    const rows = await as(db, '00000000-0000-0000-0000-000000000001', () => db.query('select * from t'));
    expect(rows.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it.** Run: `npx vitest run tests/db/rls.test.ts`

Expected: PASS. **If it fails because PGlite does not apply RLS or `set role`,
stop and tell Rémi.** The fallback is to run Task 8's tests against the hosted
dev project (Prerequisites), with users created through the service-role admin API.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "test(db): PGlite harness with Supabase auth stub"`

---

### Task 7: Migration — tables, triggers, functions, RLS

**Files:** create `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_realtime.sql`; test `tests/db/odour-sync.test.ts`

- [ ] **Step 1: Write a failing test that the SQL odour list matches the app list**

`tests/db/odour-sync.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ODOURS } from '../../src/domain/odours';

it('SQL odour check constraint lists exactly the app odour ids', () => {
  const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8');
  const match = sql.match(/odour_id text not null check \(odour_id in \(([^)]*)\)\)/);
  expect(match).not.toBeNull();
  const ids = match![1].split(',').map((s) => s.trim().replace(/'/g, ''));
  expect(ids.sort()).toEqual(ODOURS.map((o) => o.id).sort());
});
```

- [ ] **Step 2: Run and watch it fail** (file missing).

- [ ] **Step 3: Write `supabase/migrations/0001_init.sql`**

```sql
-- Imprint — schema, rules, permissions.
-- Records are append-only: sessions change once (Stop); corrections are new rows.

-- ───────── Tables ─────────

create table public.units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  invite_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('trainer', 'handler')),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.dogs (
  id uuid primary key,
  unit_id uuid not null references public.units(id),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key,
  unit_id uuid not null references public.units(id),
  dog_id uuid not null references public.dogs(id),
  odour_id text not null check (odour_id in ('cocaine', 'heroin', 'methamphetamine', 'mdma', 'cannabis', 'fentanyl', 'tnt', 'c4-rdx', 'petn', 'semtex', 'black-powder', 'smokeless-powder', 'ammonium-nitrate', 'det-cord', 'dynamite', 'tatp', 'hmtd')),
  handler_id uuid not null references public.members(id),
  kind text not null check (kind in ('timed', 'manual')),
  session_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_s integer check (duration_s >= 0),
  client_sent_at timestamptz,
  client_clock_offset_s integer,
  server_received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'timed' and started_at is not null)
    or (kind = 'manual' and started_at is null and ended_at is null and duration_s > 0)
  ),
  check (ended_at is null or ended_at >= started_at)
);

create table public.corrections (
  id uuid primary key,
  session_id uuid not null references public.sessions(id),
  unit_id uuid not null references public.units(id),
  trainer_id uuid not null references public.members(id),
  void boolean not null default false,
  new_duration_s integer check (new_duration_s >= 0),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((void and new_duration_s is null) or (not void and new_duration_s is not null))
);

create index on public.members (unit_id);
create index on public.dogs (unit_id);
create index on public.sessions (unit_id, updated_at);
create index on public.sessions (dog_id, odour_id);
create index on public.corrections (unit_id, updated_at);

-- ───────── Helper functions (security definer: read members without RLS) ─────────

create function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where user_id = auth.uid()
$$;

create function public.is_active_member(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
    where user_id = auth.uid() and unit_id = u and removed_at is null)
$$;

create function public.is_trainer(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
    where user_id = auth.uid() and unit_id = u and role = 'trainer' and removed_at is null)
$$;

-- True when member m is the caller, belongs to unit u, and was not removed before t.
create function public.was_me_active_at(u uuid, m uuid, t timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
    where id = m and user_id = auth.uid() and unit_id = u
      and (removed_at is null or removed_at > t))
$$;

create function public.dog_in_unit(d uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dogs where id = d and unit_id = u)
$$;

create function public.session_in_unit(s uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions where id = s and unit_id = u)
$$;

-- ───────── Triggers ─────────

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger units_touch before update on public.units
  for each row execute function public.touch_updated_at();
create trigger dogs_touch_ins before insert on public.dogs
  for each row execute function public.touch_updated_at();
create trigger corrections_touch_ins before insert on public.corrections
  for each row execute function public.touch_updated_at();

create function public.sessions_before_insert() returns trigger language plpgsql as $$
begin
  new.server_received_at := now();
  new.updated_at := now();
  new.client_clock_offset_s := case
    when new.client_sent_at is null then null
    else round(extract(epoch from (now() - new.client_sent_at)))::int
  end;
  return new;
end $$;

create trigger sessions_ins before insert on public.sessions
  for each row execute function public.sessions_before_insert();

create function public.sessions_before_update() returns trigger language plpgsql as $$
begin
  if old.ended_at is not null then
    if new.ended_at = old.ended_at and new.duration_s = old.duration_s then
      return null; -- identical retry of a Stop: skip silently
    end if;
    raise exception 'session already stopped' using errcode = '42501';
  end if;
  if new.id <> old.id or new.unit_id <> old.unit_id or new.dog_id <> old.dog_id
     or new.odour_id <> old.odour_id or new.handler_id <> old.handler_id
     or new.kind <> old.kind or new.session_date <> old.session_date
     or new.started_at is distinct from old.started_at
     or new.server_received_at <> old.server_received_at
     or new.client_clock_offset_s is distinct from old.client_clock_offset_s then
    raise exception 'only ended_at and duration_s can change' using errcode = '42501';
  end if;
  if new.ended_at is null or new.duration_s is null then
    raise exception 'stop needs ended_at and duration_s' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger sessions_upd before update on public.sessions
  for each row execute function public.sessions_before_update();

create function public.dogs_before_update() returns trigger language plpgsql as $$
begin
  if new.unit_id <> old.unit_id or new.created_by <> old.created_by then
    raise exception 'cannot move dog' using errcode = '42501';
  end if;
  if new.archived_at is not null and old.archived_at is null and exists (
    select 1 from public.sessions s
    where s.dog_id = new.id and s.kind = 'timed' and s.ended_at is null
      and not exists (select 1 from public.corrections c where c.session_id = s.id)
  ) then
    raise exception 'stop the running timer before archiving' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger dogs_upd before update on public.dogs
  for each row execute function public.dogs_before_update();

create function public.members_before_update() returns trigger language plpgsql as $$
begin
  if new.unit_id <> old.unit_id or new.user_id <> old.user_id then
    raise exception 'cannot move member' using errcode = '42501';
  end if;
  if old.role = 'trainer' and old.removed_at is null
     and (new.role <> 'trainer' or new.removed_at is not null)
     and not exists (select 1 from public.members m
       where m.unit_id = old.unit_id and m.id <> old.id
         and m.role = 'trainer' and m.removed_at is null) then
    raise exception 'a unit needs at least one trainer' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger members_upd before update on public.members
  for each row execute function public.members_before_update();

-- ───────── Row Level Security ─────────

alter table public.units enable row level security;
alter table public.members enable row level security;
alter table public.dogs enable row level security;
alter table public.sessions enable row level security;
alter table public.corrections enable row level security;

create policy units_select on public.units for select to authenticated
  using (public.is_active_member(id));

create policy members_select on public.members for select to authenticated
  using (public.is_active_member(unit_id));
create policy members_update on public.members for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

create policy dogs_select on public.dogs for select to authenticated
  using (public.is_active_member(unit_id));
create policy dogs_insert on public.dogs for insert to authenticated
  with check (public.is_trainer(unit_id) and created_by = public.my_member_id());
create policy dogs_update on public.dogs for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

create policy sessions_select on public.sessions for select to authenticated
  using (public.is_active_member(unit_id));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (
    public.was_me_active_at(unit_id, handler_id, coalesce(started_at, session_date::timestamptz))
    and public.dog_in_unit(dog_id, unit_id)
  );
create policy sessions_stop_own on public.sessions for update to authenticated
  using (handler_id = public.my_member_id() and ended_at is null)
  with check (handler_id = public.my_member_id());

create policy corrections_select on public.corrections for select to authenticated
  using (public.is_active_member(unit_id));
create policy corrections_insert on public.corrections for insert to authenticated
  with check (
    public.is_trainer(unit_id)
    and trainer_id = public.my_member_id()
    and public.session_in_unit(session_id, unit_id)
  );

-- No delete policies anywhere: nothing can be deleted through the API.

-- ───────── RPCs ─────────

create function public.gen_invite_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea;
  code text;
begin
  loop
    b := uuid_send(gen_random_uuid());  -- bytes 0-5 of a v4 UUID are random
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.units where invite_code = code);
  end loop;
  return code;
end $$;

create function public.create_unit(unit_name text, member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already in a unit' using errcode = '23505';
  end if;
  insert into public.units (name, invite_code) values (unit_name, public.gen_invite_code())
    returning id into u;
  insert into public.members (unit_id, user_id, name, role)
    values (u, auth.uid(), member_name, 'trainer');
  return u;
end $$;

create function public.join_unit(code text, member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select id into u from public.units where invite_code = upper(code);
  if u is null then raise exception 'invalid invite code' using errcode = 'P0002'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already in a unit' using errcode = '23505';
  end if;
  insert into public.members (unit_id, user_id, name, role)
    values (u, auth.uid(), member_name, 'handler');
  return u;
end $$;

create function public.regenerate_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; new_code text;
begin
  select unit_id into u from public.members
    where user_id = auth.uid() and role = 'trainer' and removed_at is null;
  if u is null then raise exception 'trainers only' using errcode = '42501'; end if;
  new_code := public.gen_invite_code();
  update public.units set invite_code = new_code where id = u;
  return new_code;
end $$;

revoke execute on function public.gen_invite_code() from public;
revoke execute on function public.create_unit(text, text) from public;
revoke execute on function public.join_unit(text, text) from public;
revoke execute on function public.regenerate_invite_code() from public;
grant execute on function public.create_unit(text, text) to authenticated;
grant execute on function public.join_unit(text, text) to authenticated;
grant execute on function public.regenerate_invite_code() to authenticated;
```

`supabase/migrations/0002_realtime.sql` (applied on Supabase only; PGlite has no publication):
```sql
alter publication supabase_realtime
  add table public.dogs, public.members, public.sessions, public.corrections;
```

- [ ] **Step 4: Run.** Run: `npx vitest run tests/db`. Expected: odour-sync and the spike pass. Task 8 loads the full migration and exercises it.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(db): schema, triggers, RLS policies and unit RPCs"`

---

### Task 8: Permission and rule tests

**Files:** extend `tests/db/rls.test.ts`

- [ ] **Step 1: Add fixtures and tests below the spike**

```ts
import type { PGlite } from '@electric-sql/pglite';
import { addUser } from './harness';

const T = '00000000-0000-0000-0000-0000000000a1'; // trainer user
const H = '00000000-0000-0000-0000-0000000000b1'; // handler user
const X = '00000000-0000-0000-0000-0000000000c1'; // other unit's trainer
const DOG = '10000000-0000-0000-0000-000000000001';

async function setup() {
  const db = await freshDb();
  for (const u of [T, H, X]) await addUser(db, u);
  await as(db, T, () => db.query(`select public.create_unit('Wells K9', 'Tess')`));
  const code = (await db.query<{ invite_code: string }>('select invite_code from units')).rows[0].invite_code;
  await as(db, H, () => db.query(`select public.join_unit($1, 'Paul')`, [code.toLowerCase()]));
  await as(db, X, () => db.query(`select public.create_unit('Other unit', 'Xavier')`));
  const ids = async (user: string) =>
    (await db.query<{ id: string; unit_id: string }>('select id, unit_id from members where user_id = $1', [user])).rows[0];
  const t = await ids(T), h = await ids(H), x = await ids(X);
  await as(db, T, () => db.query(
    `insert into dogs (id, unit_id, name, created_by) values ($1, $2, 'Rex', $3)`, [DOG, t.unit_id, t.id]));
  return { db, t, h, x, unit: t.unit_id };
}

const insertTimed = (db: PGlite, id: string, unit: string, handler: string, startedAt = '2026-10-03T10:00:00Z') =>
  db.query(
    `insert into sessions (id, unit_id, dog_id, odour_id, handler_id, kind, session_date, started_at, client_sent_at)
     values ($1, $2, $3, 'mdma', $4, 'timed', '2026-10-03', $5, now())`,
    [id, unit, DOG, handler, startedAt]);

describe('permissions', () => {
  it('invite code is 6 chars from the alphabet', async () => {
    const { db } = await setup();
    const codes = (await db.query<{ invite_code: string }>('select invite_code from units')).rows;
    for (const c of codes) expect(c.invite_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/);
  });

  it('handler cannot add a dog; trainer can', async () => {
    const { db, h, unit } = await setup();
    await expect(as(db, H, () => db.query(
      `insert into dogs (id, unit_id, name, created_by) values (gen_random_uuid(), $1, 'Nope', $2)`, [unit, h.id]),
    )).rejects.toThrow(/row-level security/);
  });

  it('handler can start and stop own session, and retrying Stop is harmless', async () => {
    const { db, h, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000001';
    await as(db, H, () => insertTimed(db, S, unit, h.id));
    const stop = () => db.query(
      `update sessions set ended_at = '2026-10-03T10:12:00Z', duration_s = 720 where id = $1`, [S]);
    await as(db, H, stop);
    await as(db, H, stop);
    const row = (await db.query<{ duration_s: number; client_clock_offset_s: number }>(
      'select duration_s, client_clock_offset_s from sessions where id = $1', [S])).rows[0];
    expect(row.duration_s).toBe(720);
    expect(row.client_clock_offset_s).toBe(0);
  });

  it("handler cannot stop another handler's session", async () => {
    const { db, t, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000002';
    await as(db, T, () => insertTimed(db, S, unit, t.id));
    const res = await as(db, H, () => db.query(
      `update sessions set ended_at = now(), duration_s = 1 where id = $1`, [S]));
    expect(res.affectedRows ?? 0).toBe(0);
  });

  it('nobody can change a session other than Stop, or delete it', async () => {
    const { db, h, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000003';
    await as(db, H, () => insertTimed(db, S, unit, h.id));
    await expect(as(db, H, () => db.query(
      `update sessions set odour_id = 'tnt', ended_at = now(), duration_s = 5 where id = $1`, [S]),
    )).rejects.toThrow(/only ended_at/);
    const del = await as(db, H, () => db.query('delete from sessions where id = $1', [S]));
    expect(del.affectedRows ?? 0).toBe(0);
  });

  it('only trainers can add corrections, and a reason is required', async () => {
    const { db, t, h, unit } = await setup();
    const S = '20000000-0000-0000-0000-000000000004';
    await as(db, H, () => insertTimed(db, S, unit, h.id));
    const add = (user: string, member: string, reason: string) => as(db, user, () => db.query(
      `insert into corrections (id, session_id, unit_id, trainer_id, void, new_duration_s, reason)
       values (gen_random_uuid(), $1, $2, $3, false, 480, $4)`, [S, unit, member, reason]));
    await expect(add(H, h.id, 'nope')).rejects.toThrow(/row-level security/);
    await expect(add(T, t.id, '  ')).rejects.toThrow(/check/);
    await add(T, t.id, 'forgot to stop, real time 8 min');
  });

  it('another unit sees nothing', async () => {
    const { db, h, unit } = await setup();
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000005', unit, h.id));
    const seen = await as(db, X, () => db.query('select * from sessions'));
    expect(seen.rows).toHaveLength(0);
    const dogs = await as(db, X, () => db.query('select * from dogs'));
    expect(dogs.rows).toHaveLength(0);
  });

  it('removed handler: earlier sessions accepted, later ones rejected, no reads', async () => {
    const { db, h, unit } = await setup();
    await as(db, T, () => db.query(
      `update members set removed_at = '2026-10-03T12:00:00Z' where id = $1`, [h.id]));
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000006', unit, h.id, '2026-10-03T11:00:00Z'));
    await expect(as(db, H, () =>
      insertTimed(db, '20000000-0000-0000-0000-000000000007', unit, h.id, '2026-10-03T13:00:00Z'),
    )).rejects.toThrow(/row-level security/);
    const seen = await as(db, H, () => db.query('select * from dogs'));
    expect(seen.rows).toHaveLength(0);
  });

  it('a unit always keeps one trainer', async () => {
    const { db, t } = await setup();
    await expect(as(db, T, () => db.query(
      `update members set role = 'handler' where id = $1`, [t.id]),
    )).rejects.toThrow(/at least one trainer/);
  });

  it('archiving a dog with a running timer is blocked', async () => {
    const { db, h, unit } = await setup();
    await as(db, H, () => insertTimed(db, '20000000-0000-0000-0000-000000000008', unit, h.id));
    await expect(as(db, T, () => db.query(
      `update dogs set archived_at = now() where id = $1`, [DOG]),
    )).rejects.toThrow(/running timer/);
  });

  it('wrong invite code and double join are refused', async () => {
    const { db } = await setup();
    const Y = '00000000-0000-0000-0000-0000000000d1';
    await addUser(db, Y);
    await expect(as(db, Y, () => db.query(`select public.join_unit('ZZZZZZ', 'Yan')`))).rejects.toThrow(/invalid invite code/);
    await expect(as(db, H, () => db.query(`select public.create_unit('Again', 'Paul')`))).rejects.toThrow(/already in a unit/);
  });
});
```

- [ ] **Step 2: Run.** Run: `npx vitest run tests/db`. Expected: all pass. Fix the SQL, not the tests, if any fail, unless a test contradicts the spec.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "test(db): RLS permissions and record rules"`

---

# Phase 3 — Local data, sync, accounts

### Task 9: Dexie database and local writes

**Files:** create `src/data/db.ts`, `src/data/repo.ts`; test `tests/data/repo.test.ts`

- [ ] **Step 1: Create `src/data/db.ts`**

```ts
import Dexie, { type Table } from 'dexie';
import type { Correction, Dog, Member, Session, Unit } from '../domain/types';

export type SyncedTable = 'dogs' | 'sessions' | 'corrections';

export interface OutboxItem {
  seq?: number;
  table: SyncedTable;
  op: 'insert' | 'update';
  row: Record<string, unknown> & { id: string };
  created_at: string;
  status: 'pending' | 'rejected';
  error?: string;
}

export interface MetaRow { key: string; value: unknown }

/** Meta key holding the signed-in member, so the app works offline. */
export const ME_KEY = 'me';

export class ImprintDB extends Dexie {
  units!: Table<Unit, string>;
  members!: Table<Member, string>;
  dogs!: Table<Dog, string>;
  sessions!: Table<Session, string>;
  corrections!: Table<Correction, string>;
  outbox!: Table<OutboxItem, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'imprint') {
    super(name);
    this.version(1).stores({
      units: 'id',
      members: 'id, unit_id, user_id',
      dogs: 'id, unit_id',
      sessions: 'id, dog_id, [dog_id+odour_id], handler_id',
      corrections: 'id, session_id',
      outbox: '++seq, status',
      meta: 'key',
    });
  }
}

export const db = new ImprintDB();
```

- [ ] **Step 2: Write the failing test `tests/data/repo.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB } from '../../src/data/db';
import {
  AlreadyRunningError, NotAllowedError, addCorrection, addDog, addManualSession,
  archiveDog, runningSessionForDog, startSession, stopSession, type Ctx,
} from '../../src/data/repo';
import type { Member } from '../../src/domain/types';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const handler: Member = { ...trainer, id: 'mH', user_id: 'uH', name: 'Paul', role: 'handler' };

let db: ImprintDB;
let clock: Date;
let n = 0;
const ctx = (me: Member): Ctx => ({ db, me, now: () => clock, uuid: () => `id-${++n}` });

beforeEach(async () => {
  db = new ImprintDB(`test-${Math.random()}`);
  clock = new Date('2026-10-03T10:00:00.000Z');
  n = 0;
});

describe('repo', () => {
  it('trainer adds a dog; handler cannot', async () => {
    const dog = await addDog(ctx(trainer), '  Rex ');
    expect(dog.name).toBe('Rex');
    expect(await db.outbox.count()).toBe(1);
    await expect(addDog(ctx(handler), 'Max')).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('start then stop writes the session and two outbox items', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await startSession(ctx(handler), dog.id, 'mdma');
    expect(s.started_at).toBe('2026-10-03T10:00:00.000Z');
    clock = new Date('2026-10-03T10:12:04.700Z');
    const stopped = await stopSession(ctx(handler), s.id);
    expect(stopped.duration_s).toBe(724);
    const items = await db.outbox.orderBy('seq').toArray();
    expect(items.map((i) => `${i.table}:${i.op}`)).toEqual(['dogs:insert', 'sessions:insert', 'sessions:update']);
    expect(items[2].row).toEqual({ id: s.id, ended_at: '2026-10-03T10:12:04.700Z', duration_s: 724 });
  });

  it('only one running session per dog', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    await startSession(ctx(handler), dog.id, 'mdma');
    await expect(startSession(ctx(trainer), dog.id, 'cocaine')).rejects.toBeInstanceOf(AlreadyRunningError);
  });

  it("only the starting handler can stop", async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await startSession(ctx(handler), dog.id, 'mdma');
    await expect(stopSession(ctx(trainer), s.id)).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('manual session stores minutes as seconds', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await addManualSession(ctx(handler), dog.id, 'mdma', '2026-10-02', 10);
    expect(s).toMatchObject({ kind: 'manual', duration_s: 600, session_date: '2026-10-02', started_at: null });
    await expect(addManualSession(ctx(handler), dog.id, 'mdma', '2026-10-02', 0)).rejects.toThrow();
  });

  it('a correction closes a forgotten running session', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    const s = await startSession(ctx(handler), dog.id, 'mdma');
    await addCorrection(ctx(trainer), s.id, { void: false, newDurationS: 480, reason: 'forgot to stop' });
    expect(await runningSessionForDog(db, dog.id)).toBeUndefined();
    await expect(addCorrection(ctx(handler), s.id, { void: true, reason: 'x' })).rejects.toBeInstanceOf(NotAllowedError);
    await expect(addCorrection(ctx(trainer), s.id, { void: true, reason: '   ' })).rejects.toThrow(/reason/);
  });

  it('cannot archive a dog with a running timer', async () => {
    const dog = await addDog(ctx(trainer), 'Rex');
    await startSession(ctx(handler), dog.id, 'mdma');
    await expect(archiveDog(ctx(trainer), dog.id)).rejects.toThrow(/running/);
  });
});
```

- [ ] **Step 3: Run and watch it fail.**

- [ ] **Step 4: Implement `src/data/repo.ts`**

```ts
import { localDate } from '../domain/format';
import { isRunning } from '../domain/totals';
import type { Correction, Dog, Member, Session } from '../domain/types';
import type { ImprintDB, OutboxItem, SyncedTable } from './db';

export interface Ctx {
  db: ImprintDB;
  me: Member;
  now?: () => Date;
  uuid?: () => string;
}

export class NotAllowedError extends Error {}
export class AlreadyRunningError extends Error {
  constructor(public running: Session) {
    super('A timer is already running on this dog');
  }
}

const nowOf = (c: Ctx) => (c.now ?? (() => new Date()))();
const idOf = (c: Ctx) => (c.uuid ?? (() => crypto.randomUUID()))();
const requireTrainer = (c: Ctx) => {
  if (c.me.role !== 'trainer') throw new NotAllowedError('Trainers only');
};

async function write(c: Ctx, table: SyncedTable, op: OutboxItem['op'], row: OutboxItem['row']) {
  await c.db.transaction('rw', c.db.table(table), c.db.outbox, async () => {
    if (op === 'insert') await c.db.table(table).add(row);
    else await c.db.table(table).update(row.id, row);
    await c.db.outbox.add({ table, op, row, created_at: nowOf(c).toISOString(), status: 'pending' });
  });
}

export async function runningSessionForDog(db: ImprintDB, dogId: string): Promise<Session | undefined> {
  const sessions = await db.sessions.where('dog_id').equals(dogId).toArray();
  const ids = sessions.map((s) => s.id);
  const corrections = await db.corrections.where('session_id').anyOf(ids).toArray();
  return sessions.find((s) => isRunning(s, corrections));
}

export async function addDog(c: Ctx, name: string): Promise<Dog> {
  requireTrainer(c);
  const clean = name.trim();
  if (!clean) throw new Error('Dog name is required');
  const dog: Dog = {
    id: idOf(c), unit_id: c.me.unit_id, name: clean, created_by: c.me.id,
    created_at: nowOf(c).toISOString(), archived_at: null,
  };
  await write(c, 'dogs', 'insert', { ...dog });
  return dog;
}

export async function renameDog(c: Ctx, dogId: string, name: string): Promise<void> {
  requireTrainer(c);
  const clean = name.trim();
  if (!clean) throw new Error('Dog name is required');
  await write(c, 'dogs', 'update', { id: dogId, name: clean });
}

export async function archiveDog(c: Ctx, dogId: string): Promise<void> {
  requireTrainer(c);
  if (await runningSessionForDog(c.db, dogId)) throw new Error('Stop the running timer before archiving');
  await write(c, 'dogs', 'update', { id: dogId, archived_at: nowOf(c).toISOString() });
}

export async function startSession(c: Ctx, dogId: string, odourId: string): Promise<Session> {
  const running = await runningSessionForDog(c.db, dogId);
  if (running) throw new AlreadyRunningError(running);
  const now = nowOf(c);
  const s: Session = {
    id: idOf(c), unit_id: c.me.unit_id, dog_id: dogId, odour_id: odourId, handler_id: c.me.id,
    kind: 'timed', session_date: localDate(now), started_at: now.toISOString(),
    ended_at: null, duration_s: null, client_clock_offset_s: null, server_received_at: null,
  };
  await write(c, 'sessions', 'insert', { ...s });
  return s;
}

export async function stopSession(c: Ctx, sessionId: string): Promise<Session> {
  const s = await c.db.sessions.get(sessionId);
  if (!s || s.kind !== 'timed' || s.ended_at) throw new Error('No running session');
  if (s.handler_id !== c.me.id) throw new NotAllowedError('Only the handler who started it can stop it');
  const end = nowOf(c);
  const duration = Math.max(0, Math.floor((end.getTime() - Date.parse(s.started_at!)) / 1000));
  const patch = { id: s.id, ended_at: end.toISOString(), duration_s: duration };
  await write(c, 'sessions', 'update', patch);
  return { ...s, ...patch };
}

export async function addManualSession(
  c: Ctx, dogId: string, odourId: string, dateYmd: string, minutes: number,
): Promise<Session> {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('Minutes must be a whole number above 0');
  const s: Session = {
    id: idOf(c), unit_id: c.me.unit_id, dog_id: dogId, odour_id: odourId, handler_id: c.me.id,
    kind: 'manual', session_date: dateYmd, started_at: null, ended_at: null,
    duration_s: minutes * 60, client_clock_offset_s: null, server_received_at: null,
  };
  await write(c, 'sessions', 'insert', { ...s });
  return s;
}

export async function addCorrection(
  c: Ctx, sessionId: string,
  input: { void: true; reason: string } | { void: false; newDurationS: number; reason: string },
): Promise<Correction> {
  requireTrainer(c);
  const reason = input.reason.trim();
  if (!reason) throw new Error('A reason is required');
  if (!input.void && (!Number.isInteger(input.newDurationS) || input.newDurationS < 0)) {
    throw new Error('Duration must be 0 or more whole seconds');
  }
  const corr: Correction = {
    id: idOf(c), session_id: sessionId, unit_id: c.me.unit_id, trainer_id: c.me.id,
    void: input.void, new_duration_s: input.void ? null : input.newDurationS,
    reason, created_at: nowOf(c).toISOString(),
  };
  await write(c, 'corrections', 'insert', { ...corr });
  return corr;
}
```

- [ ] **Step 5: Run and watch it pass.** Expected: 7 passed.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(data): local Dexie store with outbox writes"`

---

### Task 10: Sync engine

**Files:** create `src/data/remote.ts`, `src/data/sync.ts`; test `tests/data/sync.test.ts`

- [ ] **Step 1: Create `src/data/remote.ts`** (interface + Supabase adapter)

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RemoteError { code?: string; message: string }
export type PulledTable = 'units' | 'members' | 'dogs' | 'sessions' | 'corrections';

export interface RemoteStore {
  insert(table: string, row: Record<string, unknown>): Promise<{ error?: RemoteError }>;
  update(table: string, id: string, patch: Record<string, unknown>): Promise<{ error?: RemoteError }>;
  changesSince(table: PulledTable, unitId: string, sinceIso: string):
    Promise<{ rows: Record<string, unknown>[]; error?: RemoteError }>;
}

const err = (e: { code?: string; message: string } | null) =>
  e ? { error: { code: e.code || undefined, message: e.message } } : {};

export const supabaseRemote = (client: SupabaseClient): RemoteStore => ({
  async insert(table, row) {
    const { error } = await client.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    return err(error);
  },
  async update(table, id, patch) {
    const { error } = await client.from(table).update(patch).eq('id', id);
    return err(error);
  },
  async changesSince(table, unitId, sinceIso) {
    const q = client.from(table).select('*').gt('updated_at', sinceIso).order('updated_at');
    const { data, error } = await (table === 'units' ? q.eq('id', unitId) : q.eq('unit_id', unitId));
    return { rows: data ?? [], ...err(error) };
  },
});
```

- [ ] **Step 2: Write the failing test `tests/data/sync.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ImprintDB } from '../../src/data/db';
import { addDog, startSession, stopSession, type Ctx } from '../../src/data/repo';
import type { RemoteError, RemoteStore } from '../../src/data/remote';
import { pullChanges, pushOutbox, syncStatus } from '../../src/data/sync';
import type { Member } from '../../src/domain/types';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };

function fakeRemote(failures: (RemoteError | null)[] = []) {
  const calls: { op: string; table: string; row: Record<string, unknown> }[] = [];
  const serverRows: Record<string, Record<string, unknown>[]> = {};
  const remote: RemoteStore = {
    async insert(table, row) { const f = failures.shift(); if (f) return { error: f }; calls.push({ op: 'insert', table, row }); return {}; },
    async update(table, id, patch) { const f = failures.shift(); if (f) return { error: f }; calls.push({ op: 'update', table, row: { id, ...patch } }); return {}; },
    async changesSince(table) { return { rows: serverRows[table] ?? [] }; },
  };
  return { remote, calls, serverRows };
}

let db: ImprintDB;
let n = 0;
const ctx = (): Ctx => ({ db, me: trainer, now: () => new Date('2026-10-03T10:00:00Z'), uuid: () => `id-${++n}` });
const now = () => new Date('2026-10-03T10:30:00Z');

beforeEach(() => { db = new ImprintDB(`sync-${Math.random()}`); n = 0; });

describe('pushOutbox', () => {
  it('pushes in order, adds client_sent_at to sessions, strips server fields, clears outbox', async () => {
    const dog = await addDog(ctx(), 'Rex');
    const s = await startSession(ctx(), dog.id, 'mdma');
    await stopSession(ctx(), s.id);
    expect((await syncStatus(db)).pending).toBe(2); // dog + session; Start and Stop count once
    const { remote, calls } = fakeRemote();
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 3, rejected: 0, stalled: false });
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(['insert:dogs', 'insert:sessions', 'update:sessions']);
    expect(calls[1].row.client_sent_at).toBe('2026-10-03T10:30:00.000Z');
    expect(calls[1].row).not.toHaveProperty('server_received_at');
    expect(calls[1].row).not.toHaveProperty('client_clock_offset_s');
    expect(await db.outbox.count()).toBe(0);
  });

  it('stops at a network error and keeps the rest for later', async () => {
    await addDog(ctx(), 'Rex');
    await addDog(ctx(), 'Max');
    const { remote, calls } = fakeRemote([{ message: 'Failed to fetch' }]);
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res.stalled).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await db.outbox.count()).toBe(2);
  });

  it('marks a permission error as rejected and carries on', async () => {
    await addDog(ctx(), 'Rex');
    await addDog(ctx(), 'Max');
    const { remote, calls } = fakeRemote([{ code: '42501', message: 'new row violates row-level security policy' }]);
    const res = await pushOutbox({ db, remote, unitId: 'u1', now });
    expect(res).toEqual({ pushed: 1, rejected: 1, stalled: false });
    expect(calls).toHaveLength(1);
    const status = await syncStatus(db);
    expect(status).toMatchObject({ pending: 0, rejected: 1 });
  });
});

describe('pullChanges', () => {
  it('stores server rows and moves the cursor', async () => {
    const { remote, serverRows } = fakeRemote();
    serverRows.dogs = [{ id: 'd9', unit_id: 'u1', name: 'Bella', created_by: 'mT', created_at: '', archived_at: null, updated_at: '2026-10-03T09:00:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.dogs.get('d9'))?.name).toBe('Bella');
    expect((await db.meta.get('cursor:dogs'))?.value).toBe('2026-10-03T09:00:00.000Z');
  });

  it('does not overwrite rows that still have unsent local changes', async () => {
    const dog = await addDog(ctx(), 'Rex');
    const s = await startSession(ctx(), dog.id, 'mdma');
    await stopSession(ctx(), s.id);
    const { remote, serverRows } = fakeRemote();
    serverRows.sessions = [{ ...(await db.sessions.get(s.id)), ended_at: null, duration_s: null, updated_at: '2026-10-03T10:01:00.000Z' }];
    await pullChanges({ db, remote, unitId: 'u1', now });
    expect((await db.sessions.get(s.id))?.ended_at).not.toBeNull();
  });
});

describe('syncStatus', () => {
  it('warns when the oldest pending item is over 24 h old', async () => {
    await addDog(ctx(), 'Rex');
    const later = new Date('2026-10-04T10:00:01Z');
    expect(await syncStatus(db, later)).toMatchObject({ pending: 1, stale: true });
    expect(await syncStatus(db, new Date('2026-10-03T12:00:00Z'))).toMatchObject({ stale: false });
  });
});
```

- [ ] **Step 3: Run and watch it fail.**

- [ ] **Step 4: Implement `src/data/sync.ts`**

```ts
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
```

- [ ] **Step 5: Run and watch it pass.** Expected: 6 passed.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(data): outbox push, incremental pull, sync status"`

---

### Task 11: Supabase client, accounts, sync loop

**Files:** create `src/data/supabase.ts`, `src/data/account.ts`; modify `src/data/sync.ts` (add `startSyncLoop`)

Needs the Prerequisites done and `.env.local` filled.

- [ ] **Step 1: Create `src/data/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
);
```

- [ ] **Step 2: Create `src/data/account.ts`**

```ts
import { normalizeInviteCode } from '../domain/inviteCode';
import type { Member, Role } from '../domain/types';
import { db, ME_KEY } from './db';
import { supabase } from './supabase';

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export async function signUp(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email, password });
  fail(error);
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  fail(error);
}

export async function createUnit(unitName: string, memberName: string) {
  const { error } = await supabase.rpc('create_unit', { unit_name: unitName.trim(), member_name: memberName.trim() });
  fail(error);
  return loadMe();
}

export async function joinUnit(code: string, memberName: string) {
  const { error } = await supabase.rpc('join_unit', { code: normalizeInviteCode(code), member_name: memberName.trim() });
  fail(error);
  return loadMe();
}

/** Fetch the signed-in member and cache it locally so the app works offline. */
export async function loadMe(): Promise<Member | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from('members').select('*').eq('user_id', auth.user.id).maybeSingle();
  fail(error);
  if (!data) return null;
  await db.members.put(data);
  await db.meta.put({ key: ME_KEY, value: data });
  return data;
}

export async function regenerateInviteCode(): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_invite_code');
  fail(error);
  return data as string;
}

export async function removeMember(memberId: string) {
  const { error } = await supabase.from('members').update({ removed_at: new Date().toISOString() }).eq('id', memberId);
  fail(error);
}

export async function setRole(memberId: string, role: Role) {
  const { error } = await supabase.from('members').update({ role }).eq('id', memberId);
  fail(error);
}
```

Team actions and invite codes need signal (spec §3, Team). Everything in `repo.ts` works offline.

- [ ] **Step 3: Append `startSyncLoop` to `src/data/sync.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export function startSyncLoop(d: SyncDeps, client: SupabaseClient, intervalMs = 30_000): () => void {
  let busy = false;
  const run = async () => {
    if (busy || !navigator.onLine) return;
    busy = true;
    try { await syncOnce(d); } catch { /* retried on the next tick */ } finally { busy = false; }
  };
  const channel = client.channel(`unit-${d.unitId}`);
  for (const table of ['dogs', 'members', 'sessions', 'corrections']) {
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
```

- [ ] **Step 4: Apply the migrations to the Supabase project**

Open the Supabase dashboard **SQL Editor**, paste and run `0001_init.sql`, then `0002_realtime.sql`.
Expected: "Success. No rows returned" for both.

- [ ] **Step 5: Verify.** Run: `npm test && npm run build`. Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(data): Supabase client, account actions, sync loop"`

---

# Phase 4 — Screens (Trainer's Field Guide style)

Build every screen to match `docs/design/reference-4c-trainers-field-guide.png`
and spec §11. Use the correct words (the reference's text is garbled).

### Task 12: Theme, font, shared components

**Files:** create `src/ui/theme.css` and `src/ui/components/*.tsx`; test `tests/ui/components.test.tsx`

- [ ] **Step 0: Create `src/hooks/useNow.ts`** (needed by `RunningBanner`)

```ts
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 1: Create `src/ui/theme.css`**

```css
@import '@fontsource/nunito/600.css';
@import '@fontsource/nunito/700.css';
@import '@fontsource/nunito/800.css';

:root {
  --paper: #F5EFDC;
  --rule: #E3D9BC;
  --mustard: #B8901C;
  --olive: #55601F;
  --ink: #1E1A14;
  --stamp: #C0322B;
  --radius: 14px;
  --tap: 48px;
  font-family: 'Nunito', system-ui, sans-serif;
  font-weight: 600;
  color: var(--ink);
  background: var(--paper);
}

body {
  margin: 0;
  min-height: 100dvh;
  background:
    repeating-linear-gradient(to bottom, transparent 0 31px, var(--rule) 31px 32px),
    var(--paper);
}

h1, h2, h3 { font-weight: 800; margin: 0; }
button { font: inherit; min-height: var(--tap); cursor: pointer; }
.num { font-variant-numeric: tabular-nums; }
```

Import it once in `src/main.tsx`: `import './ui/theme.css';`

- [ ] **Step 2: Write the component tests** (`tests/ui/components.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CompassRing } from '../../src/ui/components/CompassRing';
import { Monogram } from '../../src/ui/components/Monogram';
import { PillToggle } from '../../src/ui/components/PillToggle';
import { ProgressBar } from '../../src/ui/components/ProgressBar';

describe('components', () => {
  it('ProgressBar caps at 100% and exposes progress to screen readers', () => {
    render(<ProgressBar valueS={9000} label="MDMA" />);
    const bar = screen.getByRole('progressbar', { name: 'MDMA' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('CompassRing shows the fraction of 75 min', () => {
    render(<CompassRing totalS={2250}>12:04</CompassRing>);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('12:04')).toBeInTheDocument();
  });

  it('PillToggle switches group', async () => {
    const onChange = vi.fn();
    render(<PillToggle value="narcotics" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Explosives' }));
    expect(onChange).toHaveBeenCalledWith('explosives');
  });

  it('Monogram shows the first letter', () => {
    render(<Monogram name="rex" />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run and watch it fail.**

- [ ] **Step 4: Implement the components**

Each component is one file in `src/ui/components/`, styled with inline styles or a
co-located CSS module, using only the theme tokens.

| Component | Props | Look |
|---|---|---|
| `HeaderBar` | `title`, `onBack?`, `right?` | Mustard bar, ink title 28px/800, optional back arrow |
| `Card` | `children`, `onClick?` | 1.5px ink outline, radius 14, paper fill |
| `PillToggle` | `value: OdourGroup`, `onChange` | Two tabs "Narcotics" / "Explosives", ink outline; selected is ink-filled with paper text. `role="tablist"` / `role="tab"` |
| `ProgressBar` | `valueS`, `label` | Olive fill on paper, ink outline, height 18, `role="progressbar"`, `aria-valuenow` = % of 4500 capped at 100 |
| `CompassRing` | `totalS`, `children` | See code below |
| `ImprintedStamp` | `size?: 'row' \| 'hero'` | Red "IMPRINTED" in a double border, rotated −8°, slightly rough edge (SVG `feTurbulence` displacement) |
| `Monogram` | `name` | 52px circle, ink double border, first letter 800, rotated −4° like a stamp |
| `SyncBadge` | `pending`, `rejected`, `stale` | Hidden at 0/0. "3 records not synced yet" ("1 record …"); stale: "Open with signal before clearing this phone."; rejected: "1 record rejected by the server" |
| `RunningBanner` | `items: {dog, odour, handler, startedAt}[]` | Mustard strip "Running · Rex · MDMA · 12:04 · Paul" with live clock (uses `useNow`) |
| `Sheet` | `open`, `onClose`, `title`, `children` | Bottom sheet on paper with ink top border |

`CompassRing.tsx`:
```tsx
import type { ReactNode } from 'react';
import { IMPRINT_TARGET_S } from '../../domain/totals';

export function CompassRing({ totalS, children }: { totalS: number; children: ReactNode }) {
  const pct = Math.min(100, Math.round((totalS / IMPRINT_TARGET_S) * 100));
  const r = 100, c = 2 * Math.PI * r;
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
         aria-label="Progress toward 75 minutes" style={{ position: 'relative', width: 260, height: 260 }}>
      <svg viewBox="0 0 260 260" width="260" height="260">
        <g transform="translate(130 130)">
          {ticks.map((i) => (
            <line key={i} x1="0" y1={i % 5 === 0 ? -124 : -120} x2="0" y2="-114"
                  stroke="var(--ink)" strokeWidth={i % 5 === 0 ? 2 : 1}
                  transform={`rotate(${i * 6})`} />
          ))}
          <circle r={r} fill="none" stroke="var(--rule)" strokeWidth="18" />
          <circle r={r} fill="none" stroke="var(--olive)" strokeWidth="18"
                  strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90)" />
          <circle r={r + 9} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
          <circle r={r - 9} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
        </g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run and watch it pass.** Expected: 4 passed.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(ui): Field Guide theme and shared components"`

---

### Task 13: Hooks, routing, welcome screen

**Files:** create `src/hooks/useMe.ts`, `src/hooks/useUnitData.ts`, `src/ui/screens/WelcomeScreen.tsx`; modify `src/App.tsx`

- [ ] **Step 1: Create the hooks** (`useNow` already exists from Task 12)

`src/hooks/useMe.ts`:
```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ME_KEY } from '../data/db';
import type { Member } from '../domain/types';

/** undefined = still loading, null = not signed in / no unit. */
export function useMe(): Member | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get(ME_KEY))?.value as Member) ?? null, []);
}
```

`src/hooks/useUnitData.ts`: live queries returning `{ dogs (active, by name), members, sessions, corrections, unit }` from Dexie, each via `useLiveQuery`, defaulting to `[]`.

- [ ] **Step 2: Implement `WelcomeScreen`** with three steps on one screen:
  1. **Sign in / Sign up** tabs: email + password (+ name for sign up).
  2. After auth, if no member: **Create a unit** (unit name + your name) or **Join with a code** (code + your name).
  3. On success, `loadMe()` stores the member and the app routes to Dogs.

  Errors map to plain messages: no network → "Needs signal once to sign in.";
  `invalid invite code` → "That code doesn't match a unit. Ask your trainer for the current code.";
  `already in a unit` → "This account already belongs to a unit."
  Show a pen-and-ink working-dog drawing at the top (an inline SVG line drawing; ink stroke on paper).

- [ ] **Step 3: Replace `src/App.tsx` with the router and sync bootstrap**

```tsx
import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { db } from './data/db';
import { supabaseRemote } from './data/remote';
import { startSyncLoop } from './data/sync';
import { supabase } from './data/supabase';
import { useMe } from './hooks/useMe';
import { DogScreen } from './ui/screens/DogScreen';
import { DogsScreen } from './ui/screens/DogsScreen';
import { LogScreen } from './ui/screens/LogScreen';
import { TeamScreen } from './ui/screens/TeamScreen';
import { TimerScreen } from './ui/screens/TimerScreen';
import { WelcomeScreen } from './ui/screens/WelcomeScreen';

export default function App() {
  const me = useMe();

  useEffect(() => {
    if (!me) return;
    return startSyncLoop({ db, remote: supabaseRemote(supabase), unitId: me.unit_id }, supabase);
  }, [me?.unit_id]);

  if (me === undefined) return null;
  if (me === null) return <WelcomeScreen />;

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<DogsScreen />} />
        <Route path="/dog/:dogId" element={<DogScreen />} />
        <Route path="/dog/:dogId/timer/:odourId" element={<TimerScreen />} />
        <Route path="/dog/:dogId/log" element={<LogScreen />} />
        <Route path="/team" element={me.role === 'trainer' ? <TeamScreen /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </HashRouter>
  );
}
```

Create empty placeholder components for the screens not built yet so the build passes.

- [ ] **Step 4: Verify.** Run: `npm test && npm run build`. Then `npm run dev`, sign up as a trainer, create a unit, and check that the app lands on the (placeholder) Dogs screen and still opens after a reload with the network off (DevTools → Offline).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): routing, hooks, welcome and join flow"`

---

### Task 14: Dogs screen

**Files:** `src/ui/screens/DogsScreen.tsx`; test `tests/ui/dogs.test.tsx`

- [ ] **Step 1: Write a failing test** that seeds a Dexie database (trainer member in meta, two dogs, sessions) and asserts:
  - each dog card shows its name and a progress line listing odours with time
    logged, most recently trained first, imprinted ones as "✓" (e.g. "MDMA 42/75 · Cocaine ✓");
  - a running session shows the banner "Running · Rex · MDMA · … · Paul";
  - "+ Add dog" is visible for a trainer and absent for a handler;
  - the sync badge shows "1 record not synced yet" when one record is pending, and "3 records not synced yet" for three.

  Render the screen inside a `MemoryRouter`. To point the screen at the test database, have the hooks read from `db` exported by `src/data/db.ts`, and in the test `await db.delete(); await db.open();` in `beforeEach`.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** `HeaderBar` "Dogs" (right side: "Team" link for trainers), `RunningBanner`, `SyncBadge`, a list of `Card`s with `Monogram` + name (24px/800) + progress line. "+ Add dog" opens a `Sheet` with one name field → `addDog`. Tap a card → `/dog/:id`. Empty state: ink dog drawing and "No dogs yet" (trainer: "Add your first dog").

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): dogs screen"`

---

### Task 15: Dog screen

**Files:** `src/ui/screens/DogScreen.tsx`; test `tests/ui/dog.test.tsx`

- [ ] **Step 1: Write a failing test** asserting:
  - Narcotics is selected by default and lists the 6 narcotics in spec order;
  - switching to Explosives lists the 11 explosives;
  - an odour at 4500 s shows the IMPRINTED stamp and no fraction; one at 2520 s shows "42/75" and a bar at 56%;
  - the selected group is kept in the URL (`?group=explosives`) so Back returns to it;
  - trainer sees "Rename" and "Archive"; handler doesn't. Archive while a timer runs shows "Stop the running timer before archiving".

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** `HeaderBar` with the dog name and back arrow; `PillToggle`; one row per odour: name (20px/800), `ProgressBar`, and either "42/75" or `ImprintedStamp size="row"`. Totals include live elapsed time for a running session (`useNow` + `odourTotal(..., now)`). Row tap → `/dog/:id/timer/:odourId`. "Log" button → `/dog/:id/log`.

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): dog screen with odour progress"`

---

### Task 16: Timer screen

**Files:** `src/ui/screens/TimerScreen.tsx`; test `tests/ui/timer.test.tsx`

- [ ] **Step 1: Write a failing test** using `vi.useFakeTimers({ shouldAdvanceTime: true })` and `vi.setSystemTime`:
  - Start creates a running session and the clock counts up: after advancing 724 s it shows "12:04";
  - the caption reads "{total} / 75 min total" where total includes live time;
  - Stop saves and shows "+12 min · now 54/75" (seed 42 min of earlier sessions);
  - if another handler's session is running on this dog, Start is disabled and the text reads "Paul is already running MDMA on Rex.";
  - if *this* handler has the running session, Stop is shown; if someone else does, Stop is not shown;
  - after 9 000 s the clock reads "2:30:00" and keeps running (no auto-stop).

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** Layout per the reference: header "• Rex •" / "MDMA" (800, centred), `CompassRing` with the session clock (64px/800 tabular) and the caption inside, a wide mustard "Start"/"Stop" button (min-height 64), and the link "Add a session I forgot to time" opening `ManualEntrySheet` (Task 18). Session clock = `liveElapsed(running, corrections, now)`. Ring and caption use `odourTotal(..., now)`. On Start catch `AlreadyRunningError` and show the message.

  Celebration hook-up: keep `prevTotal` in a `useRef`. On each render, if `crossedTarget(prevTotal.current, total)`, set `celebrate = true`; then update the ref. Initialise the ref with the first computed total so opening an already-imprinted odour doesn't fire it.

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): timer screen"`

---

### Task 17: Celebration

**Files:** `src/ui/Celebration.tsx`, `src/ui/celebration.css`; test `tests/ui/celebration.test.tsx`

- [ ] **Step 1: Write a failing test**: rendering `<Celebration dog="Rex" odour="MDMA" onDone={fn} />` shows "Rex: MDMA imprinted" and the stamp; clicking anywhere calls `onDone`; `navigator.vibrate` is called with `[80, 40, 120]` when it exists and nothing throws when it doesn't.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** A full-screen overlay (paper at 85% opacity) that plays, in about 2.5 s:
  1. **Ring glow** (0–400 ms): the overlay sits above the timer, and the ring underneath gets a class that pulses `filter: drop-shadow(0 0 12px var(--olive))`.
  2. **Stamp drop** (300–750 ms): `ImprintedStamp size="hero"` animates `transform: scale(2.4) rotate(-14deg); opacity: 0` → `scale(0.92) rotate(-8deg); opacity: 1` → `scale(1) rotate(-8deg)` with `cubic-bezier(.2,.9,.3,1.2)`, plus an ink splash: an SVG blot behind the stamp scaling 0 → 1 with opacity 0.25.
  3. **Paw prints** (700–1600 ms): six small ink paw SVGs start at the centre and move to random angles 90–140 px away while fading out.
  4. **Text** (900 ms): "**Rex: MDMA imprinted**" fades and rises 8 px.
  5. Call `navigator.vibrate?.([80, 40, 120])` on mount.

  `@media (prefers-reduced-motion: reduce)`: no movement; the stamp and text appear at once. Tap anywhere → `onDone`. Also use it after a manual entry crosses 75 (Task 18).

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Check by eye.** In `npm run dev`, add a 74-minute manual entry, start the timer, and wait 60 s. Check the sequence plays once, the timer keeps counting underneath, and the IMPRINTED stamp then shows on the dog screen.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(ui): 75-minute imprinted celebration"`

---

### Task 18: Manual entry

**Files:** `src/ui/screens/ManualEntrySheet.tsx`; test `tests/ui/manual.test.tsx`

- [ ] **Step 1: Write a failing test**: the sheet has a date (default today, no future dates) and a whole-minutes field; Save with 10 → a manual session of 600 s is stored and the sheet closes; 0, blank or decimals show "Enter whole minutes above 0"; if the new total crosses 75:00 the `onCrossed` callback fires.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement** with `Sheet`, `addManualSession`, and before/after totals → `crossedTarget` → `onCrossed()` (the timer screen shows `Celebration`).

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): manual session entry"`

---

### Task 19: Log and corrections

**Files:** `src/ui/screens/LogScreen.tsx`, `src/ui/screens/CorrectionSheet.tsx`; test `tests/ui/log.test.tsx`

- [ ] **Step 1: Write a failing test** that seeds sessions and asserts:
  - totals per odour at the top (only odours with time logged);
  - rows newest first: date, odour, handler name, duration (`formatClock`), label;
  - labels: **Timed**, **Manual**, **Corrected by Tess, 3 Oct**, **Voided**, **Overlap**, **Clock check** (several can apply);
  - a corrected row shows the original duration struck through (`<s>`), the new value and the reason;
  - the odour filter narrows the list;
  - trainer sees "Correct" and "Void" on each row; handler sees neither;
  - the correction sheet requires a reason ("A reason is required") and takes minutes + seconds for a new duration.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** Use `currentDuration`, `latestCorrection`, `overlappingSessionIds`, `needsClockCheck`. Sort key: `started_at ?? session_date`, newest first. "Running" rows show a live clock and the label **Running**. `CorrectionSheet` calls `addCorrection`; "Void" asks for a reason in the same sheet.

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): session log with corrections"`

---

### Task 20: Team screen

**Files:** `src/ui/screens/TeamScreen.tsx`; test `tests/ui/team.test.tsx` (mock `src/data/account.ts` with `vi.mock`)

- [ ] **Step 1: Write a failing test**: the invite code is shown large with letter spacing; "New code" calls `regenerateInviteCode` after confirmation ("The old code will stop working."); each active member shows name + role, "Make trainer"/"Make handler" and "Remove" (confirmation: "Remove Paul? Their past sessions stay in the log."); removed members are listed greyed under "Removed"; when offline (`navigator.onLine === false`) the buttons are disabled with "Team changes need signal."; the server error "a unit needs at least one trainer" shows "A unit needs at least one trainer."

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** After each action call `loadMe()` and let the sync loop refresh members.

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): team management for trainers"`

---

# Phase 5 — Installable, tested end to end, deployed

### Task 21: PWA

**Files:** modify `vite.config.ts`; create `public/icon.svg`; generated PNG icons

- [ ] **Step 1: Create `public/icon.svg`**: mustard rounded square, ink paw print, small red stamp ring.

- [ ] **Step 2: Generate icons**

```bash
npx @vite-pwa/assets-generator --preset minimal-2023 public/icon.svg
```

Expected: `public/pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`.

- [ ] **Step 3: Configure `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/imprint/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Imprint',
        short_name: 'Imprint',
        description: 'Odour imprinting log for K9 units',
        theme_color: '#B8901C',
        background_color: '#F5EFDC',
        display: 'standalone',
        start_url: '/imprint/',
        scope: '/imprint/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
    }),
  ],
});
```

Add to `index.html` `<head>`: `<link rel="apple-touch-icon" href="/imprint/apple-touch-icon-180x180.png">`, `<meta name="theme-color" content="#B8901C">`, and `<title>Imprint</title>`.

- [ ] **Step 4: Verify.** Run: `npm run build && npm run preview`. In Chrome DevTools → Application: the manifest has no errors and the service worker is active. Tick **Offline**, reload: the app opens and shows local data.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: installable PWA with offline app shell"`

---

### Task 22: Offline end-to-end test

**Files:** create `playwright.config.ts`, `tests/e2e/seed.ts`, `tests/e2e/offline.spec.ts`

Needs `.env.local` and `.env.test.local` (Prerequisites).

- [ ] **Step 1: `tests/e2e/seed.ts`** uses the service-role key (from `.env.test.local`, never committed) and `supabase.auth.admin.createUser` to create two confirmed test users with random emails `imprint-e2e-<random>@example.test` and random passwords. It signs in as the first, calls `create_unit`, then signs in as the second and calls `join_unit`. It writes the generated credentials to `test-results/e2e-users.json` (git-ignored) and deletes the users in teardown.

- [ ] **Step 2: `playwright.config.ts`**: `webServer: { command: 'npm run build && npm run preview -- --port 4173', url: 'http://localhost:4173/imprint/' }`, `use.baseURL` the same, projects `chromium` and `webkit` (`devices['iPhone 14']`), `globalSetup: './tests/e2e/seed.ts'`.

- [ ] **Step 3: Write `tests/e2e/offline.spec.ts`**

Scenario:
1. Trainer signs in, adds dog "Rex".
2. Handler signs in on a second browser context and sees "Rex" appear (Realtime, within 10 s).
3. Handler: `context.setOffline(true)`, open Rex → Narcotics → MDMA, Start, wait 3 s, Stop. The log shows one **Timed** session; the badge reads "1 record not synced yet".
4. `context.setOffline(false)`: the badge disappears within 35 s.
5. The trainer's context shows the session in Rex's log with handler name and duration.
6. Reloading the handler page while offline still shows the session.

- [ ] **Step 4: Run.** Run: `npm run e2e`. Expected: passes on chromium and webkit.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "test(e2e): offline session sync across two handlers"`

---

### Task 23: Deploy to GitHub Pages (ask Rémi first)

This publishes the app at a public URL. The data stays private (RLS, invite code),
but **confirm with Rémi before creating the repo and pushing.**

- [ ] **Step 1: Create `.github/workflows/pages.yml`**

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.d.outputs.page_url }}' }
    steps:
      - id: d
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: With Rémi's OK**, create the repo and set the secrets (Rémi pastes the values):

```bash
gh repo create imprint --public --source . --push
gh secret set VITE_SUPABASE_URL
gh secret set VITE_SUPABASE_ANON_KEY
gh api -X POST repos/{owner}/imprint/pages -f build_type=workflow
```

- [ ] **Step 3: Verify** the Actions run is green and `https://<user>.github.io/imprint/` loads.

- [ ] **Step 4: Commit** any workflow fixes.

---

### Task 24: Real-phone check (Rémi + agent)

On one iPhone and one Android phone:

- [ ] Open the URL, Add to Home Screen, open from the icon: full screen, mustard status bar.
- [ ] Trainer creates the unit on phone A; handler joins with the code on phone B.
- [ ] Phone B: airplane mode, run a 1-minute MDMA session, lock the phone for 30 s mid-timer, unlock: the clock is still correct.
- [ ] Turn airplane mode off: the badge clears; phone A shows the session.
- [ ] Phone A starts a timer: phone B shows the running banner within seconds.
- [ ] Add a 74-minute manual entry, run the timer past 75:00: the celebration plays (vibration on Android only).
- [ ] Trainer corrects a session: phone B shows "Corrected by …" with the reason.

Record the results in `docs/PHONE-CHECK.md` and commit.

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §2 decisions 1–16 | Tasks 2–24 (odours T2; 75:00 T3; roles T7–8; offline T9–10, T22; PWA T21; style T12–19) |
| §3 screens | T13–T20 |
| §4 timer behaviour, corrected running session not running | T3 (`isRunning`), T9, T16 |
| §5 celebration incl. re-trigger and reduced motion | T5, T16, T17, T18 |
| §6 data and rules 1–7 | T3, T4, T7, T8, T9 |
| §7 architecture and sync | T9, T10, T11, T21 |
| §8 permissions | T7, T8 |
| §9 error handling | T8 (trainer floor, archive, invite), T10 (stale, rejected), T13 (signal), T20 |
| §10 testing | Vitest T2–T20, PGlite T6–T8, Playwright T22, phones T24 |
| §11 visual direction | T12, T14–T17, T21 icons |
| §12 out of scope | Nothing built for export, dog details, custom odours, App Store, notifications, multi-unit, dark mode |

---

# Amendments — 2026-10-09

Spec changes: §2 decisions 7, 8, 17, 18; §6 rule 1 exception and `deleted_dogs`;
§8 rows; new §8a Export. Each amendment task below runs **right after** the task
named in its heading, same TDD rhythm (failing test → watch it fail → implement →
pass → commit).

### Task A1 (after Task 8): delete-forever on the server

**Files:** new migration `supabase/migrations/0002_delete_forever.sql`; tests in `tests/db/delete-forever.test.ts`.

- `deleted_dogs` table: `dog_id uuid primary key, unit_id uuid not null references units, deleted_by uuid not null references members, deleted_at timestamptz not null default now()`. RLS on; members of the unit can select; no insert/update/delete policies. Add an `updated_at`-style column or reuse `deleted_at` for the incremental pull, matching how Task 10 pulls other tables.
- `delete_dog_forever(dog uuid) returns void`, plpgsql, `security definer set search_path = public`, `revoke execute ... from public; grant ... to authenticated`. Refuses unless: caller is an active (not removed) trainer of the dog's unit; the dog is archived; the dog has no running session. Then, in that order: delete corrections of the dog's sessions, delete the sessions, delete the dog, insert the `deleted_dogs` row. If Task 7 added triggers or `force row level security` that block these deletes, make the function the one permitted path (e.g. a transaction-local setting the trigger checks) — do not loosen the API-level "no delete" rule.
- Restore: confirm the Task 7 policies let a trainer set `archived_at` back to null and a handler cannot; add the test either way.
- Tests: handler refused; trainer of another unit refused; non-archived dog refused; dog with a running session refused; trainer succeeds → dog, sessions, corrections gone, tombstone visible to a handler of the unit and invisible to another unit; plain `delete from dogs` / `delete from sessions` through the API is still refused for a trainer.
- Commit: `feat(db): trainer-only delete-forever for archived dogs`.

### Task A2 (after Task 10): sync purges deleted dogs

- Pull `deleted_dogs` incrementally like the other tables and via the Realtime subscription. For each tombstone: delete the local dog, its sessions and corrections, and any outbox items that reference that dog.
- An outbox insert rejected because its dog no longer exists (FK violation) is dropped, not left stuck, and surfaces once as "A session for a deleted dog was discarded."
- Tests in the sync test file: tombstone purges local rows + outbox; FK-rejected insert is dropped with the notice.
- Commit: `feat(sync): purge dogs deleted forever`.

### Task 15 changes (Dog screen)

Carried over from the review of the Base44 version:
- Archive asks first: "Archive Bella? It disappears from the list; you can restore it from Archived." (dialog, not one tap).
- The Narcotics/Explosives tab lives in the URL (`?group=explosives`), so coming back from the timer keeps it. With no `group` in the URL, open on the group of the running odour, else narcotics.
- The live clock only ticks while this dog has a running session.
- Group toggle buttons have `aria-pressed`; decorative dots are `aria-hidden`.
- Trainers also get "Progress report (PDF)" here (built in Task A4; hide until then).

### Task A3 (after Task 19): archived dogs, restore, delete forever

**Files:** `src/ui/screens/ArchivedDogsScreen.tsx` (route `/archived`), link "Archived (n)" at the bottom of the Dogs screen for trainers only; `deleteDogForever` + `restoreDog` in `src/data/actions.ts` (restore goes through the outbox; delete-forever is an online-only RPC like team changes).
- Each archived dog: name, archived date, "Restore", "Delete forever". Delete forever opens a dialog: "This erases Bella and all N sessions. It cannot be undone. Type Bella to confirm." The button stays disabled until the typed name matches exactly (trimmed, case-sensitive).
- Offline: both buttons disabled with "Needs signal." for delete; restore works offline.
- Handlers never see the link or the route (redirect to `/`).
- Tests: handler doesn't see the link; typed-name gate; offline state; success removes the dog locally.
- Commit: `feat(ui): archived dogs with restore and delete forever`.

### Task A4 (after Task 20): export

**Files:** `src/export/csv.ts` (pure), `src/export/imprintedDate.ts` (pure), `src/export/pdf.ts` (dynamic `import('jspdf')`), `src/export/share.ts`; tests in `tests/export/`.
- `sessionsCsv(...)` builds the §8a CSV: BOM, header row, RFC 4180 quoting (commas, quotes, newlines in names/reasons), current duration from the domain functions (Task 3), voided rows kept with `voided = yes`.
- `imprintedDate(sessions, corrections)` per odour: chronological running total of current durations; the date of the session that reaches 4500 s, or null.
- `dogReportPdf(...)` returns a Blob (test: starts with `%PDF`, size > 0). Layout per §8a.
- `shareOrDownload(blob, filename)`: `navigator.canShare?.({ files: [file] })` → `navigator.share`; else object-URL download. User cancelling the share sheet is not an error.
- UI: Team screen gets "Export all sessions (CSV)" (trainers); Dog screen gets "Progress report (PDF)" (trainers). Both show the unsynced-items warning from §8a when the outbox is not empty.
- Commit: `feat(export): CSV of all sessions and per-dog PDF report`.

### Task 23 note

Rémi approved a **public** repo + GitHub Pages on 2026-10-09. Still confirm the repo name with Rémi immediately before the first push.

---

# Amendments 2 — 2026-10-10 (spec §13: teams, dog details, breeds, odour catalogue)

Same TDD rhythm. No live Supabase project exists and nothing is deployed, so the
schema can change freely, but do it as a new additive migration so 0001–0004 and
their tests stay readable history.

### Task B1: schema and permissions
`supabase/migrations/0005_teams_catalogue.sql` + `tests/db/teams-catalogue.test.ts`.
- Tables: `teams` (id, unit_id, name, created_by, created_at, archived_at, updated_at), `odour_categories` (id, unit_id, name, sort, created_at, archived_at, updated_at), `odours` (id uuid, unit_id, category_id, name, created_at, archived_at, updated_at), `team_odours` (team_id, odour_id, unit_id, selected bool, updated_at, primary key (team_id, odour_id)), `deleted_teams` (team_id, unit_id, deleted_by, deleted_at, updated_at).
- `dogs`: add `team_id` (not null, FK), `breed` (text, check in the nine ids of §13.3), `purpose` (text, check in `single`,`dual`).
- `sessions.odour_id` becomes a FK to `odours(id)`; replace whatever fixed-list check 0001 has. A session's odour must belong to the session's unit.
- Case-insensitive unique names (§13.4). Realtime publication for the new tables (keep the "realtime" file-naming rule the harness expects, or a separate `0006_…realtime.sql`).
- `create_unit` seeds the default catalogue (§13.4) with stable, deterministic naming so tests can find rows by name.
- RLS per §13.5: members of the unit can select; only active trainers insert/update teams, dogs, categories, odours, team_odours; no delete policies. Handlers: insert sessions, stop own running session, nothing else. **Handlers lose nothing they need to add time, and gain no write access to the new tables.** Archiving a team is refused while one of its dogs has a running session.
- `delete_team_forever(team uuid)`: security definer, active trainer of the team's unit only, team must be archived, no running sessions; deletes corrections → sessions → dogs (writing `deleted_dogs` tombstones) → team_odours → team, writes `deleted_teams`; revoked from `public, anon`; same uniform "trainers only" error as `delete_dog_forever`.
- Also revoke `anon` EXECUTE on the remaining security-definer helpers if RLS for `authenticated` still works afterwards (prove with a test); otherwise leave them and say why.
- Tests from both roles and from another unit for every rule above.

### Task B2: domain, local store, sync, actions
- Replace the fixed `ODOURS` module with catalogue-driven helpers; keep a `DEFAULT_CATALOGUE` constant that mirrors what `create_unit` seeds (test that the two stay in sync, as the existing odour-sync test does). `BREEDS` constant (id, label). Row types for the new tables; `Dog` gains team_id, breed, purpose.
- Dexie schema bump with the new tables; outbox + pull + realtime for them; tombstone purge for `deleted_teams` (team, its dogs, their sessions/corrections, matching outbox items).
- Actions (trainer checks mirrored client-side): createTeam, renameTeam, archiveTeam, restoreTeam, deleteTeamForever (online RPC), setTeamOdours, addCategory, renameCategory, archiveCategory, restoreCategory, addOdour, renameOdour, archiveOdour, restoreOdour, addDog(name, teamId, breed, purpose), editDog, moveDog. Totals, flags, celebration, export helpers take odour ids from the catalogue.
- Update every existing test and the dev demo seed (`src/dev/demoSeed.ts`): 3 teams (one archived), dogs with breeds and purposes, the four default categories, one custom category with one custom odour, different odour selections per team.

### Task B3: screens — teams and dogs
- Routes: `/` Teams; `/team/:teamId` dogs of a team; dog, timer, log routes as before; `/members` (the former Team screen, renamed in UI and route; `/team` no longer means members); `/archived` lists archived teams and dogs.
- Teams screen: cards (name, dog count, running dot); trainer: "+ New team", "Members", "Odours", "Archived (n)". Handler: just the team cards.
- Team screen: its dogs (card shows small breed drawing, name, "Breed · Purpose", progress line); trainer: "+ Add dog", settings sheet (rename, odours, reports, archive with confirmation).
- Add/Edit dog sheet: name, breed picker (grid of the nine, large `BreedPortrait` playing on choice — use a placeholder drawing until Task B5 lands the art), purpose toggle, team select (edit only).
- Dog screen: category tabs from the team's odours (`?cat=`), default to the running odour's category else the first. Handler sees no Log link; `/dog/:id/log` redirects handlers to the dog screen.
- Archived screen: teams (restore, delete forever with typed name, online-only) and dogs.
- Handler-side tests for every hidden control and redirected route.

### Task B4: odour catalogue screens
- `/odours` (trainer only): categories with their odours; add category, add odour, rename, archive, "Archived" section with restore. Duplicate names rejected with a clear message.
- Team odour picker (in new-team flow and team settings): categories with tick-boxes, "select all" per category; at least one odour required.
- Dog screen, timer, log, manual entry all read names from the catalogue; "(not in current list)" marking per §13.4.

### Task B5: breed art and `BreedPortrait`
- Art files arrive at `public/breeds/<id>.webp` (made separately). Component per §13.3 with per-breed nose points in a small config, reduced-motion fallback, tests for: plays on choice, static when reduced motion, alt text = breed label.
- Add the nine files to the PWA precache.

### Task B6: reports
- Team PDF and team CSV per §13.6; new CSV columns everywhere; dog PDF header shows breed and purpose and uses the team's categories. Tests as in Task A4.
