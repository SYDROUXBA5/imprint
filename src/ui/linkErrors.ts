export const NOT_CONFIGURED = "This copy of the app isn't connected to a server yet.";
export const INVALID_LINK = "That link doesn't work any more. Ask your trainer for the new one.";

/** True when the request never reached the server: no signal, or the browser says it is offline. */
export function isNoSignal(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /failed to fetch|network|load failed|fetch/i.test(message) || (e instanceof Error && /Fetch/.test(e.name));
}

/** Plain-language messages for the things that actually go wrong when opening a link and picking a name. */
export function friendlyLinkError(e: unknown, noSignal: string): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/not configured/i.test(message)) return NOT_CONFIGURED;
  if (isNoSignal(e)) return noSignal;
  if (/invalid link/i.test(message)) return INVALID_LINK;
  if (/name taken/i.test(message)) return 'That name is already on the list. Tap it above.';
  if (/name not available/i.test(message)) return 'That name is not on the list any more.';
  if (/name needed/i.test(message)) return 'Type your name (up to 60 letters).';
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return "This copy of the app can't open links yet: the server has anonymous sign-ins switched off.";
  }
  return message || 'That did not work. Try again.';
}
