-- Imprint — access by two secret links, no accounts (spec §14).
--
-- Replaces email/password sign-up, invite codes, create_unit / join_unit and role changes.
-- Each phone gets a silent Supabase anonymous identity (auth.uid()). A phone opens a link (one for
-- trainers, one for handlers), picks a name, and from then on it is a "device":
--   * its POWER is the scope of the link it used (trainer | handler), never the name it picked;
--   * it is ACTIVE only while its link is still the current one (generation) and its name is on the list;
--   * Row Level Security stays the enforcement. The helper functions the policies call are rewritten on
--     `devices`, so every existing policy keeps working unchanged.
--
-- Upgrading a database that already holds accounts keeps the unit, its names and all its history: every
-- existing unit gets its two links (the owner reads them once from `unit_links` in the SQL editor), and
-- every existing member becomes a name on the list of their old role.

-- ───────── Members become names ─────────
-- (Data first, while the old trigger is still in place; the stricter trigger follows.)

-- Names must now be unique per role among non-removed members: rename namesakes "Paul", "Paul (2)", ...
update public.members m set name = m.name || ' (' || d.rn || ')'
  from (select id, row_number() over (partition by unit_id, role, lower(btrim(name)) order by joined_at, id) as rn
        from public.members where removed_at is null) d
  where m.id = d.id and d.rn > 1;

alter table public.members drop constraint members_user_id_key;
alter table public.members drop constraint members_user_id_fkey;
alter table public.members alter column user_id drop not null;
update public.members set user_id = null;  -- an old account means nothing now; kept only as a nullable column

alter table public.members add constraint members_id_unit_role_uq unique (id, unit_id, role);
create unique index members_name_uq on public.members (unit_id, role, lower(btrim(name))) where removed_at is null;

-- Members are only ever written by the functions below (which run as the table owner). The API cannot
-- insert, rename, re-role or remove one.
drop policy members_update on public.members;

create or replace function public.members_before_update() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.unit_id <> old.unit_id or new.role <> old.role
     or new.name <> old.name or new.joined_at <> old.joined_at then
    raise exception 'only removed_at can change' using errcode = '42501';
  end if;
  if old.role = 'trainer' and old.removed_at is null and new.removed_at is not null
     and not exists (select 1 from public.members m
       where m.unit_id = old.unit_id and m.id <> old.id
         and m.role = 'trainer' and m.removed_at is null) then
    raise exception 'a unit needs at least one trainer' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ───────── Retire the account model ─────────

drop function public.create_unit(text, text);
drop function public.join_unit(text, text);
drop function public.regenerate_invite_code();
drop function public.gen_invite_code();

-- ───────── The links ─────────
-- One current row per unit and role. `generation` goes up each time the link is replaced, which is what
-- switches off every phone that entered with the old one. Never readable through the API: the only way
-- to see a token is get_links(), for an active trainer-link phone.

create table public.unit_links (
  unit_id uuid not null references public.units(id),
  role text not null check (role in ('trainer', 'handler')),
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),  -- a random UUID without dashes: 122 random bits
  generation integer not null default 1 check (generation > 0),
  created_at timestamptz not null default now(),
  primary key (unit_id, role)
);

-- Upgrade: a unit that already exists gets its two links now (setup_unit refuses while a unit exists).
insert into public.unit_links (unit_id, role, token)
  select u.id, r.role, replace(gen_random_uuid()::text, '-', '')
  from public.units u cross join (values ('trainer'), ('handler')) as r(role);

alter table public.units drop column invite_code;

-- ───────── The phones ─────────
-- A phone is a row here from the moment it opens a link. All writes go through the functions below.

create table public.devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  scope text not null check (scope in ('trainer', 'handler')),
  link_generation integer not null,
  member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (unit_id, scope) references public.unit_links (unit_id, role),
  -- A phone can only be signed in under a name of its own unit AND its own scope: a handler-link phone
  -- can never hold a trainer name, whatever the functions do. (Not checked while member_id is null.)
  foreign key (member_id, unit_id, scope) references public.members (id, unit_id, role)
);

alter table public.unit_links enable row level security;
alter table public.devices enable row level security;
-- No policies: nothing is readable or writable through the API. Supabase grants table privileges to anon
-- and authenticated by default; take them away so the answer is "permission denied", not just "no rows".
revoke all on public.unit_links, public.devices from public, anon, authenticated;

-- ───────── RLS helpers, rewritten on devices ─────────
-- Same names and signatures as before, so every policy in 0001-0006 keeps working. Their grants stay as
-- 0005 set them (authenticated yes, anon no). Three conditions make a phone "active":
--   * l.generation = d.link_generation : the link it used is still the current one;
--   * the join on members              : the name it picked exists and was not removed.
-- And what it may DO comes from d.scope.

create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select d.member_id
  from public.devices d
  join public.unit_links l on l.unit_id = d.unit_id and l.role = d.scope and l.generation = d.link_generation
  join public.members m on m.id = d.member_id and m.removed_at is null
  where d.user_id = auth.uid()
$$;

create or replace function public.is_active_member(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.devices d
    join public.unit_links l on l.unit_id = d.unit_id and l.role = d.scope and l.generation = d.link_generation
    join public.members m on m.id = d.member_id and m.removed_at is null
    where d.user_id = auth.uid() and d.unit_id = u)
$$;

create or replace function public.is_trainer(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.devices d
    join public.unit_links l on l.unit_id = d.unit_id and l.role = d.scope and l.generation = d.link_generation
    join public.members m on m.id = d.member_id and m.removed_at is null
    where d.user_id = auth.uid() and d.unit_id = u
      and d.scope = 'trainer')
$$;

-- True when member m is the name the caller's phone is signed in under, in unit u, and was not removed
-- before t. A removed name's earlier offline work is still accepted; a stale link's is not.
create or replace function public.was_me_active_at(u uuid, m uuid, t timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.devices d
    join public.unit_links l on l.unit_id = d.unit_id and l.role = d.scope and l.generation = d.link_generation
    join public.members mm on mm.id = d.member_id
    where d.user_id = auth.uid() and d.unit_id = u and d.member_id = m
      and (mm.removed_at is null or mm.removed_at > t))
$$;

-- "Stop own session": any phone signed in under the handler's name may stop it (so a handler can stop
-- their timer from another phone).
drop policy sessions_stop_own on public.sessions;
create policy sessions_stop_own on public.sessions for update to authenticated
  using (ended_at is null
    and public.was_me_active_at(unit_id, handler_id, coalesce(started_at, session_date::timestamptz)))
  with check (
    public.was_me_active_at(unit_id, handler_id, coalesce(started_at, session_date::timestamptz)));

-- ───────── Setting a unit up (the owner, once, from the SQL editor) ─────────

-- Internal: creates a unit with its catalogue and its two links. The owner calls setup_unit; tests that
-- need a second unit call this directly. Nobody reaches it through the API.
create function public.make_unit(unit_name text) returns table (role text, token text, path text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid;
begin
  if btrim(coalesce(unit_name, '')) = '' then
    raise exception 'a unit needs a name' using errcode = '23514';
  end if;
  insert into public.units (name) values (btrim(unit_name)) returning id into u;
  perform public.seed_default_catalogue(u);
  insert into public.unit_links (unit_id, role, token)
    select u, r, replace(gen_random_uuid()::text, '-', '') from unnest(array['trainer', 'handler']) as r;
  return query
    select l.role, l.token, '#/' || l.role || '/' || l.token
    from public.unit_links l where l.unit_id = u order by l.role desc;  -- trainer first
end $$;

create function public.setup_unit(unit_name text) returns table (role text, token text, path text)
language plpgsql volatile security definer set search_path = public as $$
begin
  if exists (select 1 from public.units) then
    raise exception 'a unit already exists' using errcode = '23505';
  end if;
  return query select * from public.make_unit(unit_name);
end $$;

revoke execute on function public.make_unit(text), public.setup_unit(text) from public, anon, authenticated;
do $$
begin
  -- Supabase's server-side role also gets EXECUTE on new functions by default; this is the owner's job only.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke execute on function public.make_unit(text), public.setup_unit(text) from service_role;
  end if;
end $$;

-- ───────── What a phone calls ─────────
-- Security definer (they write devices and members, which the API cannot). Each starts from the caller's
-- own device and checks the link is still current. A wrong or stale token gives one uniform error.

-- The caller's device row if the link it used is still the current one; otherwise a row of nulls. Internal.
create function public.live_device() returns public.devices
language sql stable security definer set search_path = public as $$
  select d.*
  from public.devices d
  join public.unit_links l on l.unit_id = d.unit_id and l.role = d.scope and l.generation = d.link_generation
  where d.user_id = auth.uid()
$$;

-- What "Who are you?" needs: the unit, the scope, and the names on that scope's list. Internal. No tokens in it.
create function public.entered_payload(u uuid, list_role text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unit_id', u,
    'unit_name', (select x.name from public.units x where x.id = u),
    'scope', list_role,
    'names', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by lower(m.name), m.id)
      from public.members m
      where m.unit_id = u and m.role = list_role and m.removed_at is null), '[]'::jsonb))
$$;

create function public.enter_with_link(link_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  l public.unit_links%rowtype;
  d public.devices%rowtype;
  keep uuid;
begin
  if auth.uid() is null then raise exception 'invalid link' using errcode = '28000'; end if;
  select * into l from public.unit_links where token = link_token;
  if not found then raise exception 'invalid link' using errcode = '28000'; end if;

  -- Opening a link makes the phone a device of that scope. It keeps its name only if it is still a valid
  -- one for this unit and scope (reopening the same link); entering the other link drops it.
  select * into d from public.devices where user_id = auth.uid();
  keep := null;
  if found and d.unit_id = l.unit_id and d.scope = l.role then
    select m.id into keep from public.members m where m.id = d.member_id and m.removed_at is null;
  end if;
  insert into public.devices (user_id, unit_id, scope, link_generation, member_id)
    values (auth.uid(), l.unit_id, l.role, l.generation, keep)
    on conflict (user_id) do update
      set unit_id = excluded.unit_id, scope = excluded.scope, link_generation = excluded.link_generation,
          member_id = excluded.member_id, updated_at = now();

  return public.entered_payload(l.unit_id, l.role);
end $$;

create function public.choose_name(member uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d public.devices%rowtype; m public.members%rowtype;
begin
  d := public.live_device();
  if d.user_id is null then raise exception 'invalid link' using errcode = '28000'; end if;
  -- Only a name on the list of the link this phone used: the scope decides, never the tapped name.
  select * into m from public.members x
    where x.id = member and x.unit_id = d.unit_id and x.role = d.scope and x.removed_at is null;
  if not found then raise exception 'name not available' using errcode = '42501'; end if;
  update public.devices set member_id = m.id, updated_at = now() where user_id = auth.uid();
  return jsonb_build_object('unit_id', d.unit_id, 'scope', d.scope, 'member_id', m.id, 'name', m.name);
end $$;

create function public.add_name(person_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d public.devices%rowtype; m public.members%rowtype; clean text;
begin
  d := public.live_device();
  if d.user_id is null then raise exception 'invalid link' using errcode = '28000'; end if;
  clean := regexp_replace(btrim(coalesce(person_name, '')), '\s+', ' ', 'g');
  if clean = '' or length(clean) > 60 then raise exception 'name needed' using errcode = '23514'; end if;
  begin
    insert into public.members (unit_id, name, role) values (d.unit_id, clean, d.scope) returning * into m;
  exception when unique_violation then
    raise exception 'name taken' using errcode = '23505';
  end;
  update public.devices set member_id = m.id, updated_at = now() where user_id = auth.uid();
  return jsonb_build_object('unit_id', d.unit_id, 'scope', d.scope, 'member_id', m.id, 'name', m.name);
end $$;

-- Back to "Who are you?": signs the phone out of its name and returns the list to pick from (the same answer
-- as opening the link, so the app never has to keep the token). Needs the phone's link to still be current.
create function public.switch_name() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d public.devices%rowtype;
begin
  d := public.live_device();
  if d.user_id is null then raise exception 'invalid link' using errcode = '28000'; end if;
  update public.devices set member_id = null, updated_at = now() where user_id = auth.uid();
  return public.entered_payload(d.unit_id, d.scope);
end $$;

-- ───────── Trainer-only ─────────
-- is_trainer() is the single place that decides: an active device whose SCOPE is trainer.

create function public.get_links() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid;
begin
  select unit_id into u from public.devices where user_id = auth.uid();
  if u is null or not public.is_trainer(u) then raise exception 'trainers only' using errcode = '42501'; end if;
  return (select jsonb_object_agg(role, token) from public.unit_links where unit_id = u);
end $$;

create function public.regenerate_link(link_role text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare u uuid; g integer; fresh text;
begin
  select unit_id into u from public.devices where user_id = auth.uid();
  if u is null or not public.is_trainer(u) then raise exception 'trainers only' using errcode = '42501'; end if;
  if link_role is null or link_role not in ('trainer', 'handler') then
    raise exception 'unknown link' using errcode = '22023';
  end if;
  fresh := replace(gen_random_uuid()::text, '-', '');
  update public.unit_links set token = fresh, generation = generation + 1
    where unit_id = u and role = link_role returning generation into g;
  -- The trainer who pressed the button keeps access when it is the trainer link; every other phone on the
  -- old generation is out until it opens the new link.
  if link_role = 'trainer' then
    update public.devices set link_generation = g, updated_at = now() where user_id = auth.uid();
  end if;
  return fresh;
end $$;

create function public.remove_member(member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare u uuid;
begin
  select unit_id into u from public.devices where user_id = auth.uid();
  if u is null or not public.is_trainer(u) then raise exception 'trainers only' using errcode = '42501'; end if;
  -- One message for "no such name" and "someone else's name".
  if not exists (select 1 from public.members where id = member and unit_id = u) then
    raise exception 'no such member' using errcode = 'P0002';
  end if;
  update public.members set removed_at = now() where id = member and removed_at is null;
end $$;

-- ───────── Who may call what ─────────
-- Supabase grants EXECUTE on new functions to anon and authenticated, and every function carries the
-- PUBLIC default, which anon inherits: revoke both. A phone needs a signed-in (anonymous) identity.

revoke execute on function
  public.enter_with_link(text), public.choose_name(uuid), public.add_name(text), public.switch_name(),
  public.get_links(), public.regenerate_link(text), public.remove_member(uuid)
  from public, anon;
grant execute on function
  public.enter_with_link(text), public.choose_name(uuid), public.add_name(text), public.switch_name(),
  public.get_links(), public.regenerate_link(text), public.remove_member(uuid)
  to authenticated;

-- Internal: only the functions above call them.
revoke execute on function public.live_device(), public.entered_payload(uuid, text) from public, anon, authenticated;
