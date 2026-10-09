-- (a) Push delete-forever tombstones to other phones over Realtime, so they purge
--     their local copy of the dog straight away (RLS still applies: only members of
--     the unit receive them). The PGlite harness runs this against a stub publication.
alter publication supabase_realtime add table public.deleted_dogs;

-- (b) Hygiene. Supabase grants EXECUTE on every new function to anon by default, and
--     0001 only revoked it from PUBLIC. These RPCs all need a signed-in caller, so
--     close them to anon explicitly. (delete_dog_forever in 0003 already does this.)
revoke execute on function public.gen_invite_code() from anon;
revoke execute on function public.create_unit(text, text) from anon;
revoke execute on function public.join_unit(text, text) from anon;
revoke execute on function public.regenerate_invite_code() from anon;
