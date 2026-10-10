import { NotAllowedError, type Ctx } from './repo';
import { supabase } from './supabase';
import { purgeDog } from './sync';

/** Restoring goes through the outbox like archiving, so it works offline. It lives beside archiveDog. */
export { restoreDog } from './repo';

/** The server's lower-case reasons ("stop the running timer before deleting") read as sentences on screen. */
const sentence = (msg: string) => (msg ? msg[0].toUpperCase() + msg.slice(1) : 'Could not delete the dog.');

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
