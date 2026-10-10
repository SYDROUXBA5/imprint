import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('supabase client module', () => {
  it('can be imported with no env, and only fails when the client is used', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const m = await import('../../src/data/supabase'); // must not throw
    expect(m.isSupabaseConfigured()).toBe(false);
    expect(() => m.getSupabase()).toThrow(/Supabase not configured/);
    expect(() => m.supabase.auth).toThrow(m.SupabaseNotConfiguredError);
    expect(() => m.supabase.from('dogs')).toThrow(/VITE_SUPABASE_URL/);
  });

  it('does not throw when the placeholder is inspected or awaited', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const { supabase } = await import('../../src/data/supabase');
    expect((supabase as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(supabase)).resolves.toBeDefined();
  });

  it('treats only one of the two variables as not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '   ');
    const m = await import('../../src/data/supabase');
    expect(m.isSupabaseConfigured()).toBe(false);
  });

  it('builds one client lazily when configured, and the proxy forwards to it', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    const m = await import('../../src/data/supabase');
    expect(m.isSupabaseConfigured()).toBe(true);
    const a = m.getSupabase();
    expect(m.getSupabase()).toBe(a);
    expect(m.supabase.auth).toBe(a.auth);
    expect(typeof m.supabase.from).toBe('function');
    expect(m.supabase.from('dogs')).toBeDefined(); // bound to the real client
  });
});
