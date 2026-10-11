import type { Role } from './types';

const TOKEN = /[0-9a-f]{32}/i;
const LINK = /\/(?:trainer|handler)\/([0-9a-f]{32})(?![0-9a-f])/i;

/**
 * The token inside whatever a person pasted: a whole link, or the bare 32-character token. The role in a
 * link is ignored on purpose: the server decides what a token is for. Null when there is no token.
 */
export function parseLink(raw: string): string | null {
  const text = raw.trim();
  const inLink = LINK.exec(text);
  if (inLink) return inLink[1].toLowerCase();
  if (text.length === 32 && TOKEN.test(text)) return text.toLowerCase();
  return null;
}

/** The address to share for a role: the app's own address with the token after the #. */
export function buildLink(role: Role, token: string, origin: string, base: string): string {
  return `${origin}${base}#/${role}/${token}`;
}
