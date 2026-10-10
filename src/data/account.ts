import { normalizeInviteCode } from '../domain/inviteCode';
import type { Member, Role } from '../domain/types';
import { db, ME_KEY } from './db';
import { supabase } from './supabase';

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export async function signUp(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email, password });
  fail(error);
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  fail(error);
}

export async function createUnit(unitName: string, memberName: string) {
  const { error } = await supabase.rpc('create_unit', { unit_name: unitName.trim(), member_name: memberName.trim() });
  fail(error);
  return loadMe();
}

export async function joinUnit(code: string, memberName: string) {
  const { error } = await supabase.rpc('join_unit', { code: normalizeInviteCode(code), member_name: memberName.trim() });
  fail(error);
  return loadMe();
}

/** Fetch the signed-in member and cache it locally so the app works offline. */
export async function loadMe(): Promise<Member | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from('members').select('*').eq('user_id', auth.user.id).maybeSingle();
  fail(error);
  if (!data) return null;
  await db.members.put(data);
  await db.meta.put({ key: ME_KEY, value: data });
  return data;
}

export async function regenerateInviteCode(): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_invite_code');
  fail(error);
  return data as string;
}

export async function removeMember(memberId: string) {
  const { error } = await supabase.from('members').update({ removed_at: new Date().toISOString() }).eq('id', memberId);
  fail(error);
}

export async function setRole(memberId: string, role: Role) {
  const { error } = await supabase.from('members').update({ role }).eq('id', memberId);
  fail(error);
}

/** True when Supabase already holds a signed-in session on this device. */
export async function hasSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  fail(error);
  return !!data.session;
}
