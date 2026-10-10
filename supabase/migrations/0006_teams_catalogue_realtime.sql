-- Push the new tables over Realtime (RLS still applies: only members of the unit receive them).
-- Separate file like 0002 and 0004: the PGlite harness runs it against a stub publication.
alter publication supabase_realtime
  add table public.teams, public.odour_categories, public.odours, public.team_odours, public.deleted_teams;
