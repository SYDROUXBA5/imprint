import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (see .env.example).');
    this.name = 'SupabaseNotConfiguredError';
  }
}

const settings = () => ({
  url: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim(),
  key: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim(),
});

export function isSupabaseConfigured(): boolean {
  const { url, key } = settings();
  return !!url && !!key;
}

let client: SupabaseClient | undefined;

/** Builds the client on first use. Throws SupabaseNotConfiguredError if the env is missing. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const { url, key } = settings();
  if (!url || !key) throw new SupabaseNotConfiguredError();
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

/**
 * The client the app imports. Nothing is created (and nothing can throw) at import time, so the
 * app builds and starts without a .env.local; the first real use of it is what fails.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    // Let `await`, console.log and friends inspect the placeholder without needing a client.
    if (typeof prop === 'symbol' || prop === 'then') return undefined;
    const real = getSupabase();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
