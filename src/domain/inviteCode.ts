export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const normalizeInviteCode = (raw: string): string =>
  raw.toUpperCase().replace(/[\s-]/g, '');

export const isValidInviteCode = (code: string): boolean =>
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/.test(code);
