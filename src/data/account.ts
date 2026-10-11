import type { Role } from '../domain/types';
import { asMeRecord } from './access';
import { ACCESS_KEY, ME_KEY, db as appDb, type MeRecord } from './db';
import { supabase } from './supabase';

// Where this phone stands is read from the local database alone (see access.ts); it needs no network.
export { markLost, readAccess, type Access } from './access';

// Spec §14: no accounts. A phone opens one of two secret links (trainer or handler), picks a name, and is in.
// The server decides what the phone may do from the link it used. Here we only remember who we are.

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export interface NameChoice { id: string; name: string }
/** What opening a link, or asking for the list again, answers: the unit and the names to pick from. */
export interface Entered { unit_id: string; unit_name: string; scope: Role; names: NameChoice[] }
interface Chosen { unit_id: string; scope: Role; member_id: string; name: string }
export interface Links { trainer: string; handler: string }

/** A phone needs a silent identity before it can open a link. Two openings at once share one sign-in. */
let signingIn: Promise<void> | null = null;
function ensureSession(): Promise<void> {
  signingIn ??= (async () => {
    const { data, error } = await supabase.auth.getSession();
    fail(error);
    if (data.session) return;
    const signedIn = await supabase.auth.signInAnonymously();
    fail(signedIn.error);
  })().finally(() => { signingIn = null; });
  return signingIn;
}

/**
 * Open a link. Remembers the unit and the scope (the phone is now "entered, no name yet") and returns the
 * names to pick from. The token is sent to the server and goes nowhere else: not stored, not logged.
 */
export async function enterWithLink(token: string): Promise<Entered> {
  await ensureSession();
  const { data, error } = await supabase.rpc('enter_with_link', { link_token: token.trim().toLowerCase() });
  fail(error);
  const entered = data as Entered;
  await appDb.transaction('rw', appDb.tables, async () => {
    // Anything on the phone from another unit (or from no known unit) is not ours to show or to send.
    const before = asMeRecord((await appDb.meta.get(ME_KEY))?.value);
    if (before?.unit_id !== entered.unit_id) await Promise.all(appDb.tables.map((t) => t.clear()));
    await appDb.meta.put({ key: ME_KEY, value: { unit_id: entered.unit_id, scope: entered.scope, member_id: null } satisfies MeRecord });
    await appDb.meta.delete(ACCESS_KEY);
  });
  return entered;
}

/** The names to pick from, for the list this phone entered by. Also signs the phone out of its name on the server. */
export async function loadNames(): Promise<Entered> {
  const { data, error } = await supabase.rpc('switch_name');
  fail(error);
  return data as Entered;
}

async function signedInAs(chosen: Chosen): Promise<void> {
  await appDb.transaction('rw', appDb.meta, appDb.members, async () => {
    await appDb.members.put({
      id: chosen.member_id, unit_id: chosen.unit_id, user_id: null, name: chosen.name, role: chosen.scope,
      joined_at: new Date().toISOString(), removed_at: null,
    });
    await appDb.meta.put({
      key: ME_KEY, value: { unit_id: chosen.unit_id, scope: chosen.scope, member_id: chosen.member_id } satisfies MeRecord,
    });
    await appDb.meta.delete(ACCESS_KEY);
  });
}

/** Tap a name on the list. */
export async function chooseName(memberId: string): Promise<void> {
  const { data, error } = await supabase.rpc('choose_name', { member: memberId });
  fail(error);
  await signedInAs(data as Chosen);
}

/** "Add my name": a new name on the list this phone entered by, and the phone is in under it. */
export async function addName(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('name needed');
  const { data, error } = await supabase.rpc('add_name', { person_name: clean });
  fail(error);
  await signedInAs(data as Chosen);
}

/** "Switch": back to "Who are you?". Here and now, with no signal needed; the list is fetched by loadNames. */
export async function switchName(): Promise<void> {
  const rec = asMeRecord((await appDb.meta.get(ME_KEY))?.value);
  if (rec) await appDb.meta.put({ key: ME_KEY, value: { ...rec, member_id: null } satisfies MeRecord });
}

/** Both links, for the Members screen. Shown, never stored. */
export async function getLinks(): Promise<Links> {
  const { data, error } = await supabase.rpc('get_links');
  fail(error);
  return data as Links;
}

/** Replace one link. Everyone who entered by the old one needs the new one (the trainer pressing the button keeps access). */
export async function regenerateLink(role: Role): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_link', { link_role: role });
  fail(error);
  return data as string;
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { member: memberId });
  fail(error);
  await appDb.members.update(memberId, { removed_at: new Date().toISOString() });
}
