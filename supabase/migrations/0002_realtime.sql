-- Applied on Supabase only; PGlite has no publication.
alter publication supabase_realtime
  add table public.dogs, public.members, public.sessions, public.corrections;
