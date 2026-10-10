-- Imprint — teams, dog breed and purpose, the odour catalogue (spec §13).
--
-- Additive on top of 0001–0004. It also upgrades a database that already holds v1 data:
-- every existing dog goes into one team named "All dogs" (trained on the whole default
-- catalogue), and every session's old text odour id becomes the matching catalogue odour.
--
-- Cross-unit safety is declarative: every reference carries the unit id as well
-- ((team_id, unit_id) -> teams, (odour_id, unit_id) -> odours ...), so no row can point
-- at another unit's team, category or odour whatever the RLS policies say.

-- ───────── Tables ─────────

create table public.teams (
  id uuid primary key,
  unit_id uuid not null references public.units(id),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, unit_id)
);

create table public.odour_categories (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  name text not null check (length(trim(name)) > 0),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, unit_id)
);

create table public.odours (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  category_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, unit_id),
  foreign key (category_id, unit_id) references public.odour_categories (id, unit_id)
);

-- Which odours a team trains on. A row per team + odour, never deleted: unticking flips `selected`.
create table public.team_odours (
  team_id uuid not null,
  odour_id uuid not null,
  unit_id uuid not null references public.units(id),
  selected boolean not null,
  updated_at timestamptz not null default now(),
  primary key (team_id, odour_id),
  foreign key (team_id, unit_id) references public.teams (id, unit_id),
  foreign key (odour_id, unit_id) references public.odours (id, unit_id)
);

-- Tombstone, like deleted_dogs: lets other phones purge a team deleted forever.
create table public.deleted_teams (
  team_id uuid primary key,  -- no FK: the team row is gone
  unit_id uuid not null references public.units(id),
  deleted_by uuid not null references public.members(id),
  deleted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()  -- = deleted_at; lets sync pull it like the other tables
);

-- Names are unique per unit, case-insensitively (spec §13.4): categories in a unit, odours in a
-- category. Archived rows count, so restoring something never collides with a newer namesake.
create unique index odour_categories_name_uq on public.odour_categories (unit_id, lower(btrim(name)));
create unique index odours_name_uq on public.odours (category_id, lower(btrim(name)));

create index on public.teams (unit_id, updated_at);
create index on public.odour_categories (unit_id, updated_at);
create index on public.odours (unit_id, updated_at);
create index on public.team_odours (unit_id, updated_at);
create index on public.deleted_teams (unit_id, updated_at);

-- ───────── The default catalogue ─────────
-- Internal: create_unit (and the upgrade below) call it. Not executable through the API.

create function public.seed_default_catalogue(u uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; cat uuid;
begin
  for r in select * from (values
    ('Narcotics', 1, array['Cocaine', 'Heroin', 'Methamphetamine', 'MDMA', 'Cannabis', 'Fentanyl']),
    ('Explosives', 2, array['TNT', 'C4/RDX', 'PETN', 'Semtex', 'Black powder', 'Smokeless powder',
                            'Ammonium nitrate', 'Det cord', 'Dynamite', 'TATP', 'HMTD']),
    ('Cadaver', 3, array['Human remains']),
    ('Bed bugs', 4, array['Live bed bugs', 'Viable eggs'])
  ) as v(cat_name, cat_sort, odour_names) loop
    insert into public.odour_categories (unit_id, name, sort) values (u, r.cat_name, r.cat_sort)
      returning id into cat;
    insert into public.odours (unit_id, category_id, name)
      select u, cat, n from unnest(r.odour_names) as n;
  end loop;
end $$;

revoke execute on function public.seed_default_catalogue(uuid) from public, anon, authenticated;

create or replace function public.create_unit(unit_name text, member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already in a unit' using errcode = '23505';
  end if;
  insert into public.units (name, invite_code) values (unit_name, public.gen_invite_code())
    returning id into u;
  insert into public.members (unit_id, user_id, name, role)
    values (u, auth.uid(), member_name, 'trainer');
  perform public.seed_default_catalogue(u);
  return u;
end $$;

-- ───────── Upgrading v1 data (a no-op on an empty database) ─────────

do $$
declare u record;
begin
  for u in select id from public.units loop
    perform public.seed_default_catalogue(u.id);
  end loop;
end $$;

alter table public.dogs add column team_id uuid, add column breed text, add column purpose text;

insert into public.teams (id, unit_id, name, created_by)
  select gen_random_uuid(), unit_id, 'All dogs', (array_agg(created_by order by created_at))[1]
  from public.dogs group by unit_id;

update public.dogs d set team_id = t.id, breed = 'other', purpose = 'single'
  from public.teams t where t.unit_id = d.unit_id;

insert into public.team_odours (team_id, odour_id, unit_id, selected)
  select t.id, o.id, t.unit_id, true
  from public.teams t join public.odours o on o.unit_id = t.unit_id;

alter table public.dogs
  alter column team_id set not null,
  alter column breed set not null,
  alter column purpose set not null,
  add constraint dogs_breed_check check (breed in (
    'malinois', 'german-shepherd', 'dutch-shepherd', 'labrador', 'golden-retriever',
    'bloodhound', 'hound', 'springer-spaniel', 'other')),
  add constraint dogs_purpose_check check (purpose in ('single', 'dual')),
  add constraint dogs_team_fk foreign key (team_id, unit_id) references public.teams (id, unit_id);
create index on public.dogs (team_id);

-- sessions.odour_id: the fixed text list becomes a reference to the catalogue.
alter table public.sessions add column odour_uuid uuid;

-- sessions_upd would silently skip a change to a stopped session, so step it aside for the remap.
alter table public.sessions disable trigger sessions_upd;
update public.sessions s set odour_uuid = o.id, updated_at = now()
  from (values
    ('cocaine', 'Cocaine'), ('heroin', 'Heroin'), ('methamphetamine', 'Methamphetamine'),
    ('mdma', 'MDMA'), ('cannabis', 'Cannabis'), ('fentanyl', 'Fentanyl'), ('tnt', 'TNT'),
    ('c4-rdx', 'C4/RDX'), ('petn', 'PETN'), ('semtex', 'Semtex'), ('black-powder', 'Black powder'),
    ('smokeless-powder', 'Smokeless powder'), ('ammonium-nitrate', 'Ammonium nitrate'),
    ('det-cord', 'Det cord'), ('dynamite', 'Dynamite'), ('tatp', 'TATP'), ('hmtd', 'HMTD')
  ) as m(old_id, odour_name), public.odours o
  where m.old_id = s.odour_id and o.unit_id = s.unit_id and o.name = m.odour_name;
alter table public.sessions enable trigger sessions_upd;

alter table public.sessions drop column odour_id;  -- takes its check constraint and index with it
alter table public.sessions rename column odour_uuid to odour_id;
alter table public.sessions
  alter column odour_id set not null,
  add constraint sessions_odour_unit_fk foreign key (odour_id, unit_id) references public.odours (id, unit_id);
create index on public.sessions (dog_id, odour_id);

-- ───────── Triggers ─────────

create trigger teams_touch_ins before insert on public.teams
  for each row execute function public.touch_updated_at();
create trigger odour_categories_touch_ins before insert on public.odour_categories
  for each row execute function public.touch_updated_at();
create trigger odours_touch_ins before insert on public.odours
  for each row execute function public.touch_updated_at();
create trigger team_odours_touch_ins before insert on public.team_odours
  for each row execute function public.touch_updated_at();

create function public.teams_before_update() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.unit_id <> old.unit_id or new.created_by <> old.created_by then
    raise exception 'cannot move team' using errcode = '42501';
  end if;
  if new.archived_at is not null and old.archived_at is null and exists (
    select 1 from public.sessions s join public.dogs d on d.id = s.dog_id
    where d.team_id = new.id and s.kind = 'timed' and s.ended_at is null
      and not exists (select 1 from public.corrections c where c.session_id = s.id)
  ) then
    raise exception 'stop the running timer before archiving' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger teams_upd before update on public.teams
  for each row execute function public.teams_before_update();

create function public.odour_categories_before_update() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.unit_id <> old.unit_id then
    raise exception 'cannot move category' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger odour_categories_upd before update on public.odour_categories
  for each row execute function public.odour_categories_before_update();

create function public.odours_before_update() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.unit_id <> old.unit_id or new.category_id <> old.category_id then
    raise exception 'cannot move odour' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger odours_upd before update on public.odours
  for each row execute function public.odours_before_update();

create function public.team_odours_before_update() returns trigger language plpgsql as $$
begin
  if new.team_id <> old.team_id or new.odour_id <> old.odour_id or new.unit_id <> old.unit_id then
    raise exception 'cannot move team odour' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger team_odours_upd before update on public.team_odours
  for each row execute function public.team_odours_before_update();

-- Dogs: a dog can only be placed in (added to, moved to) an active team.
create or replace function public.dogs_before_update() returns trigger language plpgsql as $$
begin
  if new.unit_id <> old.unit_id or new.created_by <> old.created_by then
    raise exception 'cannot move dog' using errcode = '42501';
  end if;
  if new.team_id <> old.team_id and exists (
    select 1 from public.teams t where t.id = new.team_id and t.archived_at is not null
  ) then
    raise exception 'the team is archived' using errcode = '23514';
  end if;
  if new.archived_at is not null and old.archived_at is null and exists (
    select 1 from public.sessions s
    where s.dog_id = new.id and s.kind = 'timed' and s.ended_at is null
      and not exists (select 1 from public.corrections c where c.session_id = s.id)
  ) then
    raise exception 'stop the running timer before archiving' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create function public.dogs_before_insert() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.teams t where t.id = new.team_id and t.archived_at is not null) then
    raise exception 'the team is archived' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger dogs_touch_ins on public.dogs;
create trigger dogs_ins before insert on public.dogs
  for each row execute function public.dogs_before_insert();

-- ───────── Row Level Security (spec §13.5) ─────────
-- Members of a unit read it; only active trainers of the unit write. No delete policies.

alter table public.teams enable row level security;
alter table public.odour_categories enable row level security;
alter table public.odours enable row level security;
alter table public.team_odours enable row level security;
alter table public.deleted_teams enable row level security;

create policy teams_select on public.teams for select to authenticated
  using (public.is_active_member(unit_id));
create policy teams_insert on public.teams for insert to authenticated
  with check (public.is_trainer(unit_id) and created_by = public.my_member_id());
create policy teams_update on public.teams for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

create policy odour_categories_select on public.odour_categories for select to authenticated
  using (public.is_active_member(unit_id));
create policy odour_categories_insert on public.odour_categories for insert to authenticated
  with check (public.is_trainer(unit_id));
create policy odour_categories_update on public.odour_categories for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

create policy odours_select on public.odours for select to authenticated
  using (public.is_active_member(unit_id));
create policy odours_insert on public.odours for insert to authenticated
  with check (public.is_trainer(unit_id));
create policy odours_update on public.odours for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

create policy team_odours_select on public.team_odours for select to authenticated
  using (public.is_active_member(unit_id));
create policy team_odours_insert on public.team_odours for insert to authenticated
  with check (public.is_trainer(unit_id));
create policy team_odours_update on public.team_odours for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

-- Tombstones: members read; only delete_team_forever (security definer) writes.
create policy deleted_teams_select on public.deleted_teams for select to authenticated
  using (public.is_active_member(unit_id));

-- ───────── delete_team_forever ─────────
-- Like delete_dog_forever (0003): the only path that removes rows, owned by the migration role.

create function public.delete_team_forever(team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.teams%rowtype;
  me uuid;
begin
  select * into t from public.teams where id = team;
  -- One message for "no such team", "someone else's team" and "not a trainer",
  -- so the answer does not reveal whether a team id exists.
  if not found or not public.is_trainer(t.unit_id) then
    raise exception 'trainers only' using errcode = '42501';
  end if;
  me := public.my_member_id();
  if t.archived_at is null then
    raise exception 'the team must be archived first' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.sessions s join public.dogs d on d.id = s.dog_id
    where d.team_id = team and s.kind = 'timed' and s.ended_at is null
      and not exists (select 1 from public.corrections c where c.session_id = s.id)
  ) then
    raise exception 'stop the running timer before deleting' using errcode = '23514';
  end if;

  delete from public.corrections
    where session_id in (select s.id from public.sessions s join public.dogs d on d.id = s.dog_id where d.team_id = team);
  delete from public.sessions where dog_id in (select id from public.dogs where team_id = team);
  insert into public.deleted_dogs (dog_id, unit_id, deleted_by)
    select id, unit_id, me from public.dogs where team_id = team;
  delete from public.dogs where team_id = team;
  delete from public.team_odours where team_id = team;
  delete from public.teams where id = team;
  insert into public.deleted_teams (team_id, unit_id, deleted_by) values (team, t.unit_id, me);
end $$;

revoke execute on function public.delete_team_forever(uuid) from public, anon;
grant execute on function public.delete_team_forever(uuid) to authenticated;

-- ───────── Close the rest of the functions to anon ─────────
-- Supabase grants EXECUTE on new functions to anon and authenticated, and every function also
-- carries the PUBLIC default, which anon inherits, so both are revoked.
--  * RLS helpers: policies are evaluated as the signed-in user, so `authenticated` keeps EXECUTE.
--    The policies are all `to authenticated`, so anon never evaluates them; closing them to anon
--    changes nothing for it except removing a pointless RPC surface (/rest/v1/rpc/is_trainer ...).
--  * Trigger functions: nobody needs EXECUTE on them (a trigger fires without checking the
--    caller's privilege), so they are closed to everyone.
--  * gen_invite_code is only called inside the security-definer RPCs.

revoke execute on function
  public.my_member_id(), public.is_active_member(uuid), public.is_trainer(uuid),
  public.was_me_active_at(uuid, uuid, timestamptz), public.dog_in_unit(uuid, uuid),
  public.session_in_unit(uuid, uuid)
  from public, anon;
grant execute on function
  public.my_member_id(), public.is_active_member(uuid), public.is_trainer(uuid),
  public.was_me_active_at(uuid, uuid, timestamptz), public.dog_in_unit(uuid, uuid),
  public.session_in_unit(uuid, uuid)
  to authenticated;

revoke execute on function
  public.touch_updated_at(), public.sessions_before_insert(), public.sessions_before_update(),
  public.dogs_before_update(), public.dogs_before_insert(), public.members_before_update(),
  public.teams_before_update(), public.odour_categories_before_update(), public.odours_before_update(),
  public.team_odours_before_update()
  from public, anon, authenticated;

revoke execute on function public.gen_invite_code() from public, anon, authenticated;
