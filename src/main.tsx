import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/theme.css'
import App from './App.tsx'
import { demoRole } from './dev/demoMode.ts'

const root = createRoot(document.getElementById('root')!)
const render = () => root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// `npm run dev` only: ?demo=trainer or ?demo=handler fills the local database with sample data first.
// The DEV constant is false in a build, so this whole branch (and the dev/ seed) is removed from it.
const demo = import.meta.env.DEV ? demoRole() : null
if (demo) void import('./dev/demoSeed.ts').then((m) => m.startDemo(demo)).then(render)
else render()
