# Imprint

Odour imprinting log for K9 units: a timer per dog and odour, 75 minutes to imprint, works offline.

## Try it locally without a server

No Supabase project needed. In dev mode the app can fill itself with sample data (one unit, five people,
five dogs and about 25 sessions) and skip the link entry and syncing entirely.

```bash
npm install
npm run dev
```

Then open one of these (the `?demo=` part goes before the `#`):

- Trainer view: <http://localhost:5173/?demo=trainer#/>
- Handler view: <http://localhost:5173/?demo=handler#/>
- The "Who are you?" screen, with sample names: <http://localhost:5173/?demo=who#/>

Every page load wipes the local database and re-seeds it, so changes you make are not kept. Nothing is sent
anywhere: the sync loop is off and requests to other origins are blocked. Team changes and "Delete forever"
need a server, so they show an error here. Demo mode exists only under `npm run dev`; it is compiled out of
`npm run build`. To go back to real data, open the plain address without `?demo=`.

## Setting up a unit (the owner, once)

There are no accounts, no passwords and no invite codes. People get in with one of two secret links: a
**trainer link** (full control) and a **handler link** (choose a dog and add time). Opening a link shows
"Who are you?", with the names already on that link's list and "Add my name"; tap one and you are in. What a
phone may do comes from the link it opened, never from the name it tapped.

1. In the Supabase project, **Authentication > Sign In / Providers**: switch **Allow anonymous sign-ins** on
   (each phone gets a silent identity). The email provider is not used.
2. In the **SQL editor**, run the files in `supabase/migrations/` in order, `0001` to `0007`.
3. Still in the SQL editor, run this **once**:

   ```sql
   select * from setup_unit('Your unit name');
   ```

   It creates the unit and its default odour catalogue, and returns two rows, `trainer` and `handler`, each
   with a `token` (32 random hex characters) and a `path`. It is refused if a unit already exists, and only
   the SQL editor can run it: the app and the public API cannot.
4. A link is the app's address followed by the `path`:

   - trainer: `https://<user>.github.io/imprint/#/trainer/<token>`
   - handler: `https://<user>.github.io/imprint/#/handler/<token>`

   Open the trainer link on your own phone and pick or add your name. From then on the **Members** screen shows
   both links with Copy and Share, and "New link" to replace one (everyone using the old link has to open the
   new one; the names and history are untouched). Send the handler link to handlers, never the trainer link.

A phone remembers that it got in, so the app opens with no signal. A phone that has no way in (first visit,
cleared storage, a newly installed home-screen app on iPhone) shows "Open the link your trainer sent you, or
paste it here."

Upgrading a database that already had accounts: running `0007` keeps the unit, its names and all its history,
turns every member into a name on their old list, and creates the two links for the existing unit. Read them
once with `select role, token from unit_links;` in the SQL editor.

## React + TypeScript + Vite (template notes)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
