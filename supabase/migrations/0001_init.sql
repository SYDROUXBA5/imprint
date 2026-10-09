-- Imprint — schema, rules, permissions.
-- Records are append-only: sessions change once (Stop); corrections are new rows.

-- ───────── Tables ─────────

create table public.units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  invite_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('trainer', 'handler')),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.dogs (
  id uuid primary key,
  unit_id uuid not null references public.units(id),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key,
  unit_id uuid not null references public.units(id),
  dog_id uuid not null references public.dogs(id),
  odour_id text not null check (odour_id in ('cocaine', 'heroin', 'methamphetamine', 'mdma', 'cannabis', 'fentanyl', 'tnt', 'c4-rdx', 'petn', 'semtex', 'black-powder', 'smokeless-powder', 'ammonium-nitrate', 'det-cord', 'dynamite', 'tatp', 'hmtd')),
  handler_id uuid not null references public.members(id),
  kind text not null check (kind in ('timed', 'manual')),
  session_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_s integer check (duration_s >= 0),
  client_sent_at timestamptz,
  client_clock_offset_s integer,
  server_received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'timed' and started_at is not null)
    or (kind = 'manual' and started_at is null and ended_at is null and duration_s > 0)
  ),
  check (ended_at is null or ended_at >= started_at)
);

create table public.corrections (
  id uuid primary key,
  session_id uuid not null references public.sessions(id),
  unit_id uuid not null references public.units(id),
  trainer_id uuid not null references public.members(id),
  void boolean not null default false,
  new_duration_s integer check (new_duration_s >= 0),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((void and new_duration_s is null) or (not void and new_duration_s is not null))
);

create index on public.members (unit_id);
create index on public.dogs (unit_id);
create index on public.sessions (unit_id, updated_at);
create index on public.sessions (dog_id, odour_id);
create index on public.corrections (unit_id, updated_at);

-- ───────── Helper functions (security definer: read members without RLS) ─────────

create function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where user_id = auth.uid()
$$;

create function public.is_active_member(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
    where user_id = auth.uid() and unit_id = u and removed_at is null)
$$;

create function public.is_trainer(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
    where user_id = auth.uid() and unit_id = u and role = 'trainer' and removed_at is null)
$$;

-- True when member m is the caller, belongs to unit u, and was not removed before t.
create function public.was_me_active_at(u uuid, m uuid, t timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
    where id = m and user_id = auth.uid() and unit_id = u
      and (removed_at is null or removed_at > t))
$$;

create function public.dog_in_unit(d uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dogs where id = d and unit_id = u)
$$;

create function public.session_in_unit(s uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions where id = s and unit_id = u)
$$;

-- ───────── Triggers ─────────

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger units_touch before update on public.units
  for each row execute function public.touch_updated_at();
create trigger dogs_touch_ins before insert on public.dogs
  for each row execute function public.touch_updated_at();
create trigger corrections_touch_ins before insert on public.corrections
  for each row execute function public.touch_updated_at();

create function public.sessions_before_insert() returns trigger language plpgsql as $$
begin
  new.server_received_at := now();
  new.updated_at := now();
  new.client_clock_offset_s := case
    when new.client_sent_at is null then null
    else round(extract(epoch from (now() - new.client_sent_at)))::int
  end;
  return new;
end $$;

create trigger sessions_ins before insert on public.sessions
  for each row execute function public.sessions_before_insert();

create function public.sessions_before_update() returns trigger language plpgsql as $$
begin
  if old.ended_at is not null then
    if new.ended_at = old.ended_at and new.duration_s = old.duration_s then
      return null; -- identical retry of a Stop: skip silently
    end if;
    raise exception 'session already stopped' using errcode = '42501';
  end if;
  if new.id <> old.id or new.unit_id <> old.unit_id or new.dog_id <> old.dog_id
     or new.odour_id <> old.odour_id or new.handler_id <> old.handler_id
     or new.kind <> old.kind or new.session_date <> old.session_date
     or new.started_at is distinct from old.started_at
     or new.server_received_at <> old.server_received_at
     or new.client_clock_offset_s is distinct from old.client_clock_offset_s then
    raise exception 'only ended_at and duration_s can change' using errcode = '42501';
  end if;
  if new.ended_at is null or new.duration_s is null then
    raise exception 'stop needs ended_at and duration_s' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger sessions_upd before update on public.sessions
  for each row execute function public.sessions_before_update();

create function public.dogs_before_update() returns trigger language plpgsql as $$
begin
  if new.unit_id <> old.unit_id or new.created_by <> old.created_by then
    raise exception 'cannot move dog' using errcode = '42501';
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

create trigger dogs_upd before update on public.dogs
  for each row execute function public.dogs_before_update();

create function public.members_before_update() returns trigger language plpgsql as $$
begin
  if new.unit_id <> old.unit_id or new.user_id <> old.user_id then
    raise exception 'cannot move member' using errcode = '42501';
  end if;
  if old.role = 'trainer' and old.removed_at is null
     and (new.role <> 'trainer' or new.removed_at is not null)
     and not exists (select 1 from public.members m
       where m.unit_id = old.unit_id and m.id <> old.id
         and m.role = 'trainer' and m.removed_at is null) then
    raise exception 'a unit needs at least one trainer' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger members_upd before update on public.members
  for each row execute function public.members_before_update();

-- ───────── Row Level Security ─────────

alter table public.units enable row level security;
alter table public.members enable row level security;
alter table public.dogs enable row level security;
alter table public.sessions enable row level security;
alter table public.corrections enable row level security;

create policy units_select on public.units for select to authenticated
  using (public.is_active_member(id));

create policy members_select on public.members for select to authenticated
  using (public.is_active_member(unit_id));
create policy members_update on public.members for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

create policy dogs_select on public.dogs for select to authenticated
  using (public.is_active_member(unit_id));
create policy dogs_insert on public.dogs for insert to authenticated
  with check (public.is_trainer(unit_id) and created_by = public.my_member_id());
create policy dogs_update on public.dogs for update to authenticated
  using (public.is_trainer(unit_id)) with check (public.is_trainer(unit_id));

create policy sessions_select on public.sessions for select to authenticated
  using (public.is_active_member(unit_id));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (
    public.was_me_active_at(unit_id, handler_id, coalesce(started_at, session_date::timestamptz))
    and public.dog_in_unit(dog_id, unit_id)
  );
create policy sessions_stop_own on public.sessions for update to authenticated
  using (handler_id = public.my_member_id() and ended_at is null)
  with check (handler_id = public.my_member_id());

create policy corrections_select on public.corrections for select to authenticated
  using (public.is_active_member(unit_id));
create policy corrections_insert on public.corrections for insert to authenticated
  with check (
    public.is_trainer(unit_id)
    and trainer_id = public.my_member_id()
    and public.session_in_unit(session_id, unit_id)
  );

-- No delete policies anywhere: nothing can be deleted through the API.

-- ───────── RPCs ─────────

create function public.gen_invite_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea;
  code text;
begin
  loop
    b := uuid_send(gen_random_uuid());  -- bytes 0-5 of a v4 UUID are random
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.units where invite_code = code);
  end loop;
  return code;
end $$;

create function public.create_unit(unit_name text, member_name text) returns uuid
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
  return u;
end $$;

create function public.join_unit(code text, member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select id into u from public.units where invite_code = upper(code);
  if u is null then raise exception 'invalid invite code' using errcode = 'P0002'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already in a unit' using errcode = '23505';
  end if;
  insert into public.members (unit_id, user_id, name, role)
    values (u, auth.uid(), member_name, 'handler');
  return u;
end $$;

create function public.regenerate_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare u uuid; new_code text;
begin
  select unit_id into u from public.members
    where user_id = auth.uid() and role = 'trainer' and removed_at is null;
  if u is null then raise exception 'trainers only' using errcode = '42501'; end if;
  new_code := public.gen_invite_code();
  update public.units set invite_code = new_code where id = u;
  return new_code;
end $$;

revoke execute on function public.gen_invite_code() from public;
revoke execute on function public.create_unit(text, text) from public;
revoke execute on function public.join_unit(text, text) from public;
revoke execute on function public.regenerate_invite_code() from public;
grant execute on function public.create_unit(text, text) to authenticated;
grant execute on function public.join_unit(text, text) to authenticated;
grant execute on function public.regenerate_invite_code() to authenticated;
