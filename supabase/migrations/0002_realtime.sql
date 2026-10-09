-- Adds tables to the supabase_realtime publication (the PGlite harness creates a stub one).
alter publication supabase_realtime
  add table public.dogs, public.members, public.sessions, public.corrections;
