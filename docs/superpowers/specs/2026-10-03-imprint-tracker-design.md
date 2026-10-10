# Imprint — odour imprinting tracker — design

- **Date:** 2026-10-03
- **Owner:** Rémi
- **Status:** approved in brainstorming, awaiting spec review
- **Working name:** Imprint (folder `~/Documents/CLAUDE/6-app-making/imprint`)

## 1. Purpose

A small app for one K9 unit to log how long each dog has been exposed to each
target odour during imprinting. Every dog must reach **75 minutes per odour**.
Handlers time sessions with Start/Stop; the app keeps the running total, marks
the odour **Imprinted** at 75:00, and keeps a log of every session with date,
duration and handler.

## 2. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Product | Standalone app. Not part of Leash. |
| 2 | Users | Several handlers share the same dogs, each on their own phone. Data syncs between phones. |
| 3 | Target | 75:00 per dog per odour, the same for every odour. Not configurable. |
| 4 | Odours | Fixed built-in list (§6). Units cannot add odours. |
| 5 | Mistakes | Timer plus manual entries and trainer corrections, all flagged and traceable. |
| 6 | Dog details | Name only. |
| 7 | Roles | Trainer and handler (§8). The unit runs with two trainers; everyone else joins as a handler and can only add time. |
| 8 | Export | Trainers only: a CSV of every session and a PDF progress report per dog (§8a). *(Changed 2026-10-09.)* |
| 9 | Audience | Private use for one unit. No App Store, no payments. |
| 10 | Phones | Mixed iPhone and Android. |
| 11 | Signal | Mostly online, must keep working offline. |
| 12 | Build | Installable web app (PWA) + Supabase. |
| 13 | Long sessions | No duration threshold or warning. A forgotten Stop is fixed by a trainer correction. |
| 14 | Celebration | Animation when a dog's total for an odour reaches 75:00 (§5). |
| 15 | Hosting cost | Start on the Supabase free plan; move to Pro ($25/month) if pauses become a problem. |
| 16 | Visual style | "Trainer's Field Guide" (§11). |
| 17 | Removing a dog | Archive first (hidden, history kept, restorable). A trainer can then delete an archived dog forever after typing its name. *(Added 2026-10-09.)* |
| 18 | Hosting | Public GitHub repo + GitHub Pages. The code holds no secrets; all data sits in Supabase behind each member's login. *(Added 2026-10-09.)* |

## 3. Screens and flow

The core flow is: pick a dog → pick Narcotics or Explosives → pick an odour →
Start → Stop → the session is recorded.

**Join / sign in**
- The first person creates the unit and becomes its trainer. The app shows a
  6-character invite code (letters A–Z and digits 2–9, excluding 0/O/1/I).
- Handlers sign up with name, email and password, then enter the code.
- The handler name on every session comes from the signed-in account.

**Dogs (home)**
- List of active dogs. Each card shows the dog's name and a short progress line
  listing every odour with time logged (imprinted ones as "✓"), most recently
  trained first, cut to one line: e.g. "MDMA 42/75 · Cocaine ✓".
- Any running timer in the unit is pinned at the top: "Running · Rex · MDMA · 12:04 · Paul".
- Trainer only: "+ Add dog" (name only).
- A badge shows unsynced records: "3 records not synced yet".

**Dog screen**
- Toggle at the top: **Narcotics | Explosives**.
- One row per odour in that group: name, progress bar, "42/75". At 75:00 or more
  the row shows the red **IMPRINTED** stamp instead of the fraction.
- Tap a row to open its timer. A "Log" button opens the dog's log.
- Trainer only: rename, archive.

**Timer screen**
- Header: dog name and odour.
- Large elapsed time for this session, inside a compass-dial progress ring.
  The ring shows the odour total (stored total + live elapsed) against 75:00.
- Caption: "54 / 75 min total".
- **Start** / **Stop**. On Stop the session is saved and the screen shows
  "+12 min · now 54/75".
- The timer does not stop at 75:00. The handler decides when to stop.
- Link: "Add a session I forgot to time" → manual entry (date + minutes).
- If another handler already has a timer running on this dog (any odour), Start
  is disabled with the message "Paul is already running MDMA on Rex."

**Log (per dog)**
- Totals per odour at the top. Filter by odour.
- Sessions newest first: date, odour, handler, duration, and a label:
  **Timed**, **Manual**, **Corrected by [trainer], [date]**, **Voided**,
  **Overlap**, **Clock check**.
- Corrected and voided sessions show the original duration struck through,
  with the new value and the reason.
- Trainer only: "Correct" and "Void" on any session.

**Team (trainer only)**
- Member list with role. Remove a handler. Make a member trainer or handler.
- Show and regenerate the invite code. Regenerating disables the old code.

## 4. Timer behaviour

- A timed session stores the device time when Start was pressed. Elapsed time is
  always calculated as now − start, so locking the phone, switching apps or
  closing the app does not affect it.
- Only the handler who started a session can stop it. If they can't, a trainer
  corrects or voids it later.
- A timed session that has a trainer correction is no longer running, even if
  Stop was never pressed. This is how a forgotten Stop is closed and the dog
  freed for the next session.
- One running session per dog at a time, across all odours.
- A handler may run timers on different dogs at the same time.

## 5. Celebration at 75:00

**Trigger:** the displayed total for a dog + odour goes from below 4500 s to
4500 s or more. This happens live on the timer screen while the timer runs, or
when a manual entry is saved. It plays on the device where the crossing happens;
other phones simply show the stamp on their next update.

**Sequence (about 2.5 s):**
1. The compass ring finishes filling and glows briefly.
2. The red **IMPRINTED** rubber stamp drops onto the screen with a slight
   rotation, a squash on impact and an ink-splash edge.
3. A few ink paw prints scatter outward.
4. Text: "**Rex: MDMA imprinted**".
5. Vibration where supported (Android). iPhone web apps cannot vibrate.

The timer keeps running underneath. Tapping anywhere dismisses the overlay.
If a trainer correction later takes the total back below 75:00, the stamp is
removed, and the celebration plays again the next time 75:00 is reached.
With "reduce motion" switched on in the phone settings, the stamp appears
without movement.

## 6. Data and rules

**Odour list (built into the app)**

| Group | Odours |
|---|---|
| Narcotics | Cocaine, Heroin, Methamphetamine, MDMA, Cannabis, Fentanyl |
| Explosives | TNT, C4/RDX, PETN, Semtex, Black powder, Smokeless powder, Ammonium nitrate, Det cord, Dynamite, TATP, HMTD |

Each odour has a fixed id (e.g. `mdma`, `c4-rdx`, `black-powder`) used in the
database, so names can be corrected later without breaking records.

**Tables**

- `units`: id, name, invite_code, created_at
- `members`: id, unit_id, user_id, name, role (`trainer` | `handler`),
  joined_at, removed_at
- `dogs`: id, unit_id, name, created_by, created_at, archived_at
- `sessions`: id (UUID generated on the phone), unit_id, dog_id, odour_id,
  handler_id, kind (`timed` | `manual`), session_date, started_at,
  ended_at, duration_s, client_clock_offset_s, server_received_at
  - Timed: started_at set at Start; ended_at and duration_s set at Stop.
  - Manual: session_date and duration_s set; started_at/ended_at empty.
- `corrections`: id, session_id, unit_id, trainer_id, void (bool),
  new_duration_s (empty when void), reason (required, non-empty), created_at
- `deleted_dogs`: dog_id, unit_id, deleted_by, deleted_at (tombstones, read by sync)

**Rules**

1. Sessions are never edited or deleted. The only change allowed is the
   starting handler setting `ended_at` and `duration_s` once, on their own
   running session. Everything else is a new correction row. The single
   exception: a trainer deleting an archived dog forever (§8), which removes
   the dog, its sessions and its corrections in one server transaction and
   writes a `deleted_dogs` row so other phones purge their local copies.
2. A session's current duration = its latest correction's `new_duration_s`
   (by `created_at`), 0 if that correction is a void, otherwise its own
   `duration_s`.
3. Odour total = sum of current durations for that dog + odour.
   A running session adds its live elapsed time on screen only.
4. Imprinted = total ≥ 4500 s (75:00), to the second.
5. Handlers and trainers can add manual sessions. Only trainers can add
   corrections.
6. **Overlap:** two timed sessions on the same dog whose time ranges overlap (possible
   only when both were started offline) are both kept and both flagged
   "Overlap" in the log.
7. **Clock check:** at sync the app compares the phone clock with the server
   clock and stores the difference. If it is more than 10 minutes, the session
   is flagged "Clock check". The duration is still trusted, because Start and
   Stop happen on the same phone.

## 7. Architecture

- **App:** React + Vite + TypeScript, built as an installable PWA
  (vite-plugin-pwa). The app shell and fonts are cached so it opens offline.
- **Local store:** IndexedDB via Dexie. Every action writes here first.
- **Server:** Supabase, EU region (Frankfurt): auth (email + password),
  Postgres, Row Level Security, Realtime.
- **Hosting:** GitHub Pages.

**Sync**
1. Every write goes to IndexedDB and an outbox, instantly, with or without signal.
2. The outbox is pushed on app open, when the browser reports it is back online,
   and every 30 s while online. Inserts are keyed by the phone-generated UUID, so
   a retry never creates a duplicate.
3. Pull: on app open, fetch rows changed since the last sync. While online,
   subscribe to Realtime for the unit so running timers and new sessions appear
   on other phones within seconds.
4. The unsynced-items badge reads from the outbox.

Because records are only ever added (rule 1), phones cannot overwrite each other.

## 8. Roles and permissions

Enforced by Postgres Row Level Security, not only by hiding buttons.

| Action | Handler | Trainer |
|---|---|---|
| See the unit's dogs, sessions, log | ✓ | ✓ |
| Start / stop own timed session | ✓ | ✓ |
| Add manual session | ✓ | ✓ |
| Add / rename / archive / restore dog | | ✓ |
| Delete an archived dog forever (type its name to confirm) | | ✓ |
| Export CSV / PDF (§8a) | | ✓ |
| Correct or void a session | | ✓ |
| Remove member, change role, regenerate invite code | | ✓ |

No member can read or write another unit's data.

Export is a trainer-only button, not a security boundary: handlers can already
read the whole log. Delete-forever is enforced on the server by a
`delete_dog_forever` function that checks the caller is an active trainer.

## 8a. Export

Built on the phone from synced local data. If the outbox is not empty, the
export screen says "N items not synced yet; they will be missing from this
export." Files go out through the share sheet (Web Share API with a file:
Files, Mail, WhatsApp, AirDrop); where that is unavailable, a normal download.

**CSV, all sessions** (`imprint-<unit>-<yyyy-mm-dd>.csv`, UTF-8 with BOM so
Excel shows accents): one row per session, archived dogs included. Columns:
dog, dog archived, group, odour, handler, kind (timed/manual), date, start,
end, recorded duration (mm:ss and seconds), current duration after
corrections, voided, correction reasons (joined with " | "), flags (Overlap,
Clock check).

**PDF, one dog** (`imprint-<dog>-<yyyy-mm-dd>.pdf`, A4 portrait, Field Guide
colours): dog name, unit, generated date and by whom; then narcotics and
explosives tables, one row per odour: total (mm:ss), progress bar to 75:00,
date imprinted (the date of the session at which the running total, in
chronological order, reached 4500 s; blank if not yet), session count.
Footer: number of manual sessions and corrections. jsPDF, loaded only when a
PDF is generated.

## 9. Error handling

| Situation | Behaviour |
|---|---|
| First sign-in with no signal | "Needs signal once to sign in." After that the account stays signed in offline. |
| Sync keeps failing | Keep retrying; badge stays. After 24 h unsynced: "Open with signal before clearing this phone." |
| Handler removed while offline | Sessions started before `removed_at` are accepted; later ones are rejected and the phone loses access. |
| Archive a dog with a running timer | Blocked until the timer stops. |
| Two corrections on one session | The latest counts; both stay in the history. |
| Wrong or old invite code | Clear error. The trainer can regenerate a code at any time. |
| Last trainer tries to remove themself or become a handler | Blocked: a unit always has at least one trainer. |

## 10. Testing

- **Rules (Vitest):** totals, corrections, voids, latest-correction-wins,
  Imprinted at exactly 4500 s and not at 4499 s, dropping back below 75,
  celebration trigger once per crossing, overlap detection, clock-check flag.
- **Permissions (Supabase RLS tests):** handler cannot add dogs, correct
  sessions or stop another handler's session; trainer can; cross-unit reads
  and writes are refused.
- **Offline (Playwright):** start and stop with the network off, reconnect,
  no duplicates, retry safety, badge clears.
- **Real phones (one iPhone, one Android):** install to home screen, run a
  session in airplane mode, lock the phone mid-timer, see a timer appear live
  on the other phone, see the 75:00 celebration.

## 11. Visual direction — "Trainer's Field Guide"

Reference: [`docs/design/reference-4c-trainers-field-guide.png`](../../design/reference-4c-trainers-field-guide.png)
(OpenArt, Wan 2.7 Image, history id `4kZ9rmyDcPfWBTrM2POQ`). The reference
shows the style only. Its text is AI-generated and misspelled ("Narcoties",
"IMPRISTED"); the app uses the correct words.

**Palette (approximate, from the reference)**

| Token | Hex | Use |
|---|---|---|
| paper | `#F5EFDC` | background |
| rule | `#E3D9BC` | faint ruled lines, dividers |
| mustard | `#B8901C` | header bars, primary buttons |
| olive | `#55601F` | progress bars and ring |
| ink | `#1E1A14` | text, outlines, illustrations |
| stamp | `#C0322B` | IMPRINTED stamp only |

**Type:** a heavy rounded sans for headings and labels (Nunito 800/700),
Nunito 600 for body text, tabular figures for timers and totals. The font is
self-hosted so it works offline.

**Components**
- Mustard header bar with the screen title in ink.
- Cards with thin ink outlines on ruled paper.
- Pill toggle with ink outline for Narcotics | Explosives.
- Olive progress bars with an ink outline.
- Timer ring drawn as a compass dial (tick marks, olive fill).
- Red rubber-stamp "IMPRINTED" badge, slightly rotated.
- Pen-and-ink working-dog drawings on empty states and the sign-in screen.

**Change from the reference:** dogs are stored by name only, so dog cards
show a large name and an ink-stamp monogram (first letter) instead of
per-dog portraits.

**Field use:** tap targets at least 48 px so they work with gloves; ink-on-paper
contrast meets WCAG AA.

## 12. Not in version 1

Dog details beyond name, custom odours, a target other than
75 min, App Store release, push notifications, membership of several units,
dark mode.

---

## 13. Teams, dog details, breeds, odour catalogue *(added 2026-10-10)*

Supersedes decision 4 (fixed odour list), decision 6 (name only) and the
handler row "See … log" in §8. Words: the **unit** is the organisation and its
people (screen label: **Members**, formerly "Team"). A **team** is a group of dogs.

### 13.1 Teams
- A team is a named group of dogs inside the unit. Every dog belongs to exactly one team.
- Home screen = active teams (name, dog count, a dot if a timer is running in it). Tap → that team's dogs (the former Dogs screen, scoped to the team).
- Trainer only: create a team (name + which odours it trains, §13.4), rename it, archive it (refused while any of its dogs has a running timer; the team and its dogs disappear for everyone but stay in history), restore it, and delete an **archived** team forever by typing its name (removes its dogs, their sessions and corrections; `deleted_teams` + `deleted_dogs` tombstones so other phones purge).
- Dog-level archive / restore / delete-forever are unchanged. The Archived screen lists archived teams and archived dogs (with their team name).

### 13.2 Dog details
- name, team, **breed** (§13.3), **purpose**: `single` | `dual` ("Single purpose" / "Dual purpose"). A label only; it changes no behaviour.
- All required when a trainer adds a dog. Trainer-only edit (name, breed, purpose, move to another active team).
- Shown on the dog card (small breed drawing, "Malinois · Dual purpose") and the dog screen header.

### 13.3 Breeds and the breed animation
- Fixed list, ids: `malinois` (Belgian Malinois), `german-shepherd`, `dutch-shepherd`, `labrador`, `golden-retriever`, `bloodhound`, `hound`, `springer-spaniel`, `other` (generic dog).
- Art: one ink drawing per breed in the Field Guide style at `public/breeds/<id>.webp`, drawn on a light paper tone and rendered with `mix-blend-mode: multiply` so it sits on the ruled paper. Precached for offline.
- `BreedPortrait` component. When a breed is chosen in the picker it plays: ink reveal + stamp settle (~0.9 s), then an idle "sniff" loop (small head-bob of the drawing plus animated scent wisps rising from a per-breed nose point). `prefers-reduced-motion`: static drawing. Sizes: large in the picker (plays on every choice), medium in the dog header (plays once on open), small and static on cards.

### 13.4 Odour catalogue
- One catalogue per unit: **categories → odours**, stored in the database. Seeded when the unit is created: Narcotics (the 6 from §6), Explosives (the 11 from §6), Cadaver (Human remains), Bed bugs (Live bed bugs, Viable eggs).
- Trainer only: add a category; add an odour to a category; rename either; "remove" either = archive (hidden from pickers, history kept, restorable). Nothing with history is ever hard-deleted from the catalogue. Names are unique per unit, case-insensitive (categories; odours within a category).
- Per team, a trainer ticks which odours the team trains on (`team_odours`, a row per team+odour with a `selected` flag, never deleted, so it syncs like everything else).
- The dog screen shows only its team's selected, non-archived odours, grouped by category tabs (only categories with at least one). With more than three categories the tabs scroll sideways. The tab still lives in the URL (`?cat=<category id>`).
- An odour with logged time that is later unticked or archived stays in the log and reports, marked "(not in current list)".
- Sessions reference the odour by its catalogue id. The target stays 75:00 for every odour.

### 13.5 Roles *(replaces the §8 table)*

| Action | Handler | Trainer |
|---|---|---|
| See active teams, their dogs and each dog's progress | ✓ | ✓ |
| Start / stop own timed session; add a manual session | ✓ | ✓ |
| See the log; correct or void a session | | ✓ |
| Create / rename / archive / restore a team; delete an archived team forever | | ✓ |
| Add / edit / move / archive / restore a dog; delete an archived dog forever | | ✓ |
| Edit the odour catalogue; choose a team's odours | | ✓ |
| Reports: team PDF, team CSV, dog PDF, all-sessions CSV | | ✓ |
| Members: remove, change role, regenerate invite code | | ✓ |

A handler can do two things: choose a dog and add time. Enforced by Row Level
Security, not only by hiding buttons.

### 13.6 Reports
- **Team PDF** (`imprint-<team>-<yyyy-mm-dd>.pdf`): one page per active dog in the team, the §8a dog page with breed and purpose in the header and the team's categories as sections.
- **Team CSV**: the §8a CSV limited to that team.
- The all-sessions CSV and the team CSV gain columns: team, breed, purpose (written out, e.g. "Dual purpose"), and category, which takes over from the old `group` column (it already held the category name). The dog PDF's header also shows breed and purpose, and the team after the unit.
- Buttons live on the team's settings sheet (trainer only).

### 13.7 Sync
`teams`, `odour_categories`, `odours`, `team_odours` sync through the outbox and
incremental pull like `dogs`. Team delete-forever is an online-only RPC like the
dog one.
