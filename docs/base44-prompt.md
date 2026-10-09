Build a mobile-first web app called **Imprint** for a police / working K9 unit. Handlers use it to time odour-imprinting sessions for each detection dog and track progress toward 75 minutes of exposure per odour.

## Who uses it
- Private app: only people I invite can sign in.
- Two roles, using the built-in user role: **admin = Trainer**, **user = Handler**.
- Several handlers share the same dogs, each on their own phone (iPhone and Android). Everyone sees the same live data.

## Core flow
Pick a dog → choose Narcotics or Explosives → pick an odour → press Start → press Stop → the session is saved to the log with date, handler name and duration, and the dog's total for that odour goes up.

## Rules
1. Target: 75:00 (4,500 seconds) per dog per odour, the same for every odour. At 75:00 or more the odour is "Imprinted".
2. The odour list is fixed (users cannot add odours):
   - Narcotics: Cocaine, Heroin, Methamphetamine, MDMA, Cannabis, Fentanyl
   - Explosives: TNT, C4/RDX, PETN, Semtex, Black powder, Smokeless powder, Ammonium nitrate, Det cord, Dynamite, TATP, HMTD
3. Only one running timer per dog at a time, across all odours. If someone else is running one, Start is disabled with the message "Paul is already running MDMA on Rex."
4. The timer stores the moment Start was pressed and calculates elapsed time from it, so it stays correct if the phone locks, the app is closed or the page reloads. A running session is saved the moment Start is pressed so other phones can see it.
5. The timer does not stop at 75:00. No warnings for long sessions.
6. Only the handler who pressed Start can press Stop.
7. Sessions are never edited or deleted. Mistakes are fixed with a Correction (trainer only): a new duration or "void", a required reason, the trainer's name and the date. The original stays visible, struck through.
8. A session's duration = its latest correction (void = 0), otherwise its own duration. Total = sum of session durations for that dog + odour.
9. A running session that receives a correction is no longer running. This is how a forgotten Stop gets closed.
10. Handlers and trainers can add a manual session ("I forgot to time it"): date + whole minutes. It is labelled "Manual" in the log.
11. If two timed sessions on the same dog overlap in time, label both "Overlap" in the log.

## Data (entities)
- **Dog**: name (required), archived (boolean, default false).
- **ImprintSession**: dog (reference to Dog), odour (one of the 17 odours above), odour_group (narcotics | explosives), handler_name (text, copied from the user when created so it survives if they leave), handler_email, kind (timed | manual), session_date (date), started_at (datetime, timed only), ended_at (datetime, empty while running), duration_seconds (number, empty while running).
- **Correction**: session (reference to ImprintSession), is_void (boolean), new_duration_seconds (number, empty when void), reason (required text), trainer_name.

**Permissions.** Enforce these in the entity security rules, not only by hiding buttons:
- Every signed-in user: read all dogs, sessions and corrections.
- Trainer only: create, rename and archive dogs; create corrections; manage users.
- Handlers and trainers: create sessions; update only their own running session, and only to set ended_at and duration_seconds once.
- Nobody: delete sessions or corrections, or edit corrections.

## Pages
**1. Dogs (home)**
- Pinned at the top: any running timer in the unit, e.g. "Running · Rex · MDMA · 12:04 · Paul" with a live clock. Tap to open that timer.
- Active dogs as cards: big name, an ink-stamp monogram (first letter in a circle), and a one-line summary of odours with time logged, most recent first, e.g. "MDMA 42/75 · Cocaine ✓".
- Trainer only: "+ Add dog" (name only).

**2. Dog page**
- Header with the dog's name and a back arrow. Toggle: Narcotics | Explosives.
- One row per odour, in the fixed order above: name, progress bar, "42/75" (whole minutes). At 75:00 or more, show a red "IMPRINTED" rubber stamp instead of the numbers.
- Totals include the live time of a running session.
- Button: Log. Trainer only: Rename, Archive. Archive is blocked while a timer runs: "Stop the running timer before archiving".

**3. Timer page**
- Header "• Rex •" with "MDMA" below it.
- A big compass-dial progress ring (tick marks around the edge) showing the dog's total for this odour against 75:00. Inside the ring: this session's elapsed time in huge digits (12:04; 1:02:03 after an hour) and the caption "54 / 75 min total".
- A big Start / Stop button. After Stop, show "+12 min · now 54/75".
- A link "Add a session I forgot to time" opens a sheet with a date (today by default, no future dates) and whole minutes.

**4. Log page (per dog)**
- Totals per odour at the top; filter by odour.
- Sessions newest first: date, odour, handler, duration (mm:ss), and labels: Timed, Manual, Running, Corrected by [trainer] [date], Voided, Overlap.
- Corrected rows: the original duration struck through, the new value, and the reason.
- Trainer only: "Correct" (new minutes + seconds, reason required) and "Void" (reason required) on each row.

**5. Team page (trainer only)**
- List of users with their role. Invite a handler by email. Make trainer / make handler. Remove access (their past sessions stay in the log).
- There must always be at least one trainer.

## 75-minute celebration
When a dog's total for an odour goes from below 75:00 to 75:00 or more (live while the timer runs, or when a manual entry is saved), play a roughly 2.5-second animation on that phone:
1. The ring finishes filling and glows.
2. A red "IMPRINTED" rubber stamp drops onto the screen: it starts large and rotated, slams down to −8°, squashes slightly on impact, with an ink splash behind it.
3. Six small ink paw prints scatter outward and fade.
4. The text "Rex: MDMA imprinted" appears.
5. The phone vibrates on Android (navigator.vibrate). iPhone skips this.

The timer keeps running underneath, and tapping anywhere dismisses the animation. Respect the phone's "reduce motion" setting (show the stamp without movement). Don't play it when opening an odour that is already imprinted. If a correction drops the total below 75:00, the stamp disappears and the celebration can play again later.

## Weak signal
Handlers often train with poor or no signal. Make it as robust as possible:
- Never lose a Start or Stop. If saving fails, keep the action in the browser's local storage, show a small badge "2 records not synced yet", and retry automatically when the connection returns and every 30 seconds.
- The timer keeps counting from the stored start time with no connection.
- Make the app installable to the phone home screen (web app manifest, name "Imprint", theme colour #B8901C).

## Design: "Trainer's Field Guide"
I've attached the reference image; match its style. Its text was generated by AI and contains spelling mistakes, so use the correct words.
- Background: cream paper #F5EFDC with faint horizontal ruled lines #E3D9BC.
- Header bars and primary buttons: mustard #B8901C with ink-coloured text.
- Progress bars and the ring: olive #55601F with thin ink outlines.
- Text, outlines and drawings: ink #1E1A14.
- The IMPRINTED stamp only: red #C0322B, double border, slightly rotated, rough rubber-stamp edge.
- Font: Nunito, 800 for headings and big numbers, 600 for body text. Tabular figures for timers.
- Cards: thin ink outline, 14px rounded corners, sitting on the ruled paper.
- Pen-and-ink line drawings of working dogs (Malinois, German Shepherd, Labrador) on the login screen and empty states.
- Mobile first and usable one-handed. Every tap target at least 48px, so it works with gloves. Light mode only.

## Not in this version
No exports, no dog details beyond the name, no custom odours, no target other than 75 minutes, no push notifications.

## Check before you finish
- Start a timer, lock the phone for 1 minute, unlock: the clock is correct.
- Two phones: a timer started on one appears on the other.
- Add a 74-minute manual entry, then run the timer past 75:00: the celebration plays once and the stamp appears on the Dog page.
- A handler cannot see Correct, Void, Add dog or Team, and the database refuses those actions if attempted.
- Turn off Wi-Fi and data, then Start and Stop a session: the badge shows unsynced records. Reconnect: they sync and the badge clears.
