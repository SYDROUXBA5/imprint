// Loaded by the generated service worker (workbox importScripts, see vite.config.ts).
// When a new version replaces an older one, reload the pages that are still showing the old copy, so a
// phone never sits on a stale build. A first install (no older worker) reloads nothing.
let replacingOlderVersion = false;
self.addEventListener('install', () => { replacingOlderVersion = Boolean(self.registration.active); });
self.addEventListener('activate', (event) => {
  if (!replacingOlderVersion) return;
  const claimed = self.clients.claim(); // a page can only be navigated by the worker that controls it
  event.waitUntil(claimed);
  // Deliberately NOT inside waitUntil: a navigation waits for this worker to finish activating, so making
  // activation wait for the navigation would leave both waiting on each other.
  claimed
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then((pages) => { for (const page of pages) page.navigate(page.url).catch(() => undefined); })
    .catch(() => undefined);
});
