import type { Role } from '../domain/types';

/** `?demo=trainer` and `?demo=handler` open the app signed in; `?demo=who` opens the "Who are you?" screen. */
export type DemoMode = Role | 'who';

/**
 * The demo asked for in the query string (before the #). Only `npm run dev` can ever answer:
 * `import.meta.env.DEV` is a build-time constant, so in a production build this is just `return null`
 * and the seed data is never bundled.
 */
export function demoMode(): DemoMode | null {
  if (!import.meta.env.DEV) return null;
  const asked = new URLSearchParams(window.location.search).get('demo');
  return asked === 'trainer' || asked === 'handler' || asked === 'who' ? asked : null;
}
