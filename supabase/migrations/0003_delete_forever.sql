-- Delete an archived dog forever (spec §6 rule 1 exception, §8).
-- (Numbered 0003 because 0002 is the Supabase-only realtime migration.)
--
-- The API keeps its "no deletes" rule: there are still no delete policies on any
-- table. The ONLY path that removes a dog, its sessions and its corrections is the
-- security-definer function below, owned by the migration role (the table owner,
-- which RLS does not apply to). Task 7 has no delete triggers and no
-- `force row level security`, so no extra bypass is needed.

-- ───────── Tombstones (read by sync so other phones purge their local copies) ─────────

create table public.deleted_dogs (
  dog_id uuid primary key,  -- no FK: the dog row is gone
  unit_id uuid not null references public.units(id),
  deleted_by uuid not null references public.members(id),
  deleted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()  -- = deleted_at; lets sync pull it like the other tables
);

create index on public.deleted_dogs (unit_id, updated_at);

alter table public.deleted_dogs enable row level security;

-- Members of the unit can read tombstones. No insert/update/delete policies:
-- only delete_dog_forever (security definer) can write here.
create policy deleted_dogs_select on public.deleted_dogs for select to authenticated
  using (public.is_active_member(unit_id));

-- ───────── The one permitted delete path ─────────

create function public.delete_dog_forever(dog uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.dogs%rowtype;
  me uuid;
begin
  select * into d from public.dogs where id = dog;
  -- Same message for "no such dog", "someone else's dog" and "not a trainer",
  -- so the answer does not reveal whether a dog id exists.
  if not found or not public.is_trainer(d.unit_id) then
    raise exception 'trainers only' using errcode = '42501';
  end if;
  me := public.my_member_id();
  if d.archived_at is null then
    raise exception 'the dog must be archived first' using errcode = '23514';
  end if;
  -- Running = a timed session never stopped and not closed by a correction
  -- (same definition as the archive rule in dogs_before_update).
  if exists (
    select 1 from public.sessions s
    where s.dog_id = dog and s.kind = 'timed' and s.ended_at is null
      and not exists (select 1 from public.corrections c where c.session_id = s.id)
  ) then
    raise exception 'stop the running timer before deleting' using errcode = '23514';
  end if;

  delete from public.corrections
    where session_id in (select id from public.sessions where dog_id = dog);
  delete from public.sessions where dog_id = dog;
  delete from public.dogs where id = dog;
  insert into public.deleted_dogs (dog_id, unit_id, deleted_by) values (dog, d.unit_id, me);
end $$;

revoke execute on function public.delete_dog_forever(uuid) from public, anon;
grant execute on function public.delete_dog_forever(uuid) to authenticated;
