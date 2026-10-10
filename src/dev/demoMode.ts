import type { Role } from '../domain/types';

/**
 * The role asked for by `?demo=trainer` or `?demo=handler` (the query string, before the #).
 * Only `npm run dev` can ever answer: `import.meta.env.DEV` is a build-time constant, so in a
 * production build this is just `return null` and the seed data is never bundled.
 */
export function demoRole(): Role | null {
  if (!import.meta.env.DEV) return null;
  const asked = new URLSearchParams(window.location.search).get('demo');
  return asked === 'trainer' || asked === 'handler' ? asked : null;
}
