# Imprint

Odour imprinting log for K9 units: a timer per dog and odour, 75 minutes to imprint, works offline.

## Try it locally without a server

No Supabase project needed. In dev mode the app can fill itself with sample data (one unit, five people,
five dogs and about 25 sessions) and skip sign-in and syncing entirely.

```bash
npm install
npm run dev
```

Then open one of these (the `?demo=` part goes before the `#`):

- Trainer view: <http://localhost:5173/?demo=trainer#/>
- Handler view: <http://localhost:5173/?demo=handler#/>

Every page load wipes the local database and re-seeds it, so changes you make are not kept. Nothing is sent
anywhere: the sync loop is off and requests to other origins are blocked. Team changes and "Delete forever"
need a server, so they show an error here. Demo mode exists only under `npm run dev`; it is compiled out of
`npm run build`. To go back to real data, open the plain address without `?demo=`.

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
