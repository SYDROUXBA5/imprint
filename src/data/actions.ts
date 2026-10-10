import { NotAllowedError, type Ctx } from './repo';
import { supabase } from './supabase';
import { purgeDog, purgeTeam } from './sync';

/** Restoring goes through the outbox like archiving, so it works offline. It lives beside archiveDog. */
export { restoreDog } from './repo';

/** The server's lower-case reasons ("stop the running timer before deleting") read as sentences on screen. */
const sentence = (msg: string, what = 'dog') => (msg ? msg[0].toUpperCase() + msg.slice(1) : `Could not delete the ${what}.`);

/**
 * Erase an archived dog and all its sessions and corrections for everyone in the unit. Trainer-only and
 * online-only: the server function does the deleting (and leaves a tombstone so other phones purge their
 * copies); this phone is purged right after, without waiting for the next sync.
 */
export async function deleteDogForever(c: Ctx, dogId: string): Promise<void> {
  if (c.me.role !== 'trainer') throw new NotAllowedError('Trainers only');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Needs signal.');
  const { error } = await supabase.rpc('delete_dog_forever', { dog: dogId });
  if (error) throw new Error(sentence(error.message));
  await purgeDog(c.db, dogId);
}

/**
 * Erase an archived team and everything in it: its dogs and their sessions and corrections. Trainer-only and
 * online-only, like deleteDogForever. The server leaves tombstones for the team and each dog; this phone is
 * purged right after, without waiting for the next sync. (Typing the team's name to confirm is the screen's job.)
 */
export async function deleteTeamForever(c: Ctx, teamId: string): Promise<void> {
  if (c.me.role !== 'trainer') throw new NotAllowedError('Trainers only');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Needs signal.');
  const { error } = await supabase.rpc('delete_team_forever', { team: teamId });
  if (error) throw new Error(sentence(error.message, 'team'));
  await purgeTeam(c.db, teamId);
}
