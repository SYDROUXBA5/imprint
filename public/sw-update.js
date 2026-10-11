// Loaded by the generated service worker (workbox importScripts, see vite.config.ts).
// When a new version replaces an older one, reload the pages that are still showing the old copy, so a
// phone never sits on a stale build. A first install (no older worker) reloads nothing.
let replacingOlderVersion = false;
self.addEventListener('install', () => { replacingOlderVersion = Boolean(self.registration.active); });
self.addEventListener('activate', (event) => {
  if (!replacingOlderVersion) return;
  event.waitUntil((async () => {
    await self.clients.claim(); // a page can only be navigated by the worker that controls it
    const pages = await self.clients.matchAll({ type: 'window' });
    await Promise.all(pages.map((page) => page.navigate(page.url).catch(() => undefined)));
  })());
});
