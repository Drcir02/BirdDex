-- BirdDex group feed: groups, members, posts (one per shared catch), reactions, the private bucket for pictures and clips, and
-- the functions the app calls. Run once in the Supabase SQL editor (or with scripts/apply-supabase.mjs).
-- The design is docs/notes/group-feed-design.md. Nobody has an e-mail or a password: every phone signs in anonymously, and what a
-- phone may read or write is decided by the row-level security below (only members of a group see its rows).
--
-- Two more things are set once by hand and are NOT in this file, because they are secrets:
--   insert into private.config values ('founder_code_sha256', encode(extensions.digest(upper('THE-FOUNDER-CODE'), 'sha256'), 'hex'));
--   (the code that lets somebody make a new group; it keeps strangers who find the public key from filling the free storage)

create schema if not exists private;
create table if not exists private.config (key text primary key, value text not null);

-- ---------- Tables ----------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  code text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 24),
  color text not null default '#1596D8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create unique index if not exists members_nickname_unique on public.members (group_id, lower(btrim(nickname)));

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  user_id uuid not null,
  catch_id text not null check (char_length(catch_id) between 1 and 80),
  species_id text not null check (species_id ~ '^[a-z0-9-]{3,80}$'),
  method text not null check (method in ('sound', 'photo', 'live')),
  confidence real not null check (confidence between 0 and 1),
  bp integer check (bp between 0 and 5000),
  bp_base integer check (bp_base between 0 and 5000),
  bp_range integer[] check (bp_range is null or (array_length(bp_range, 1) = 2 and bp_range[1] < bp_range[2])),
  bp_factors real[] check (bp_factors is null or array_length(bp_factors, 1) = 5),
  caught_at timestamptz not null,
  place_name text check (place_name is null or char_length(place_name) <= 80),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  media_path text check (media_path is null or char_length(media_path) <= 200),
  media_kind text check (media_kind in ('image', 'audio')),
  created_at timestamptz not null default now(),
  foreign key (group_id, user_id) references public.members(group_id, user_id) on delete cascade,
  unique (group_id, user_id, catch_id),
  check ((media_path is null) = (media_kind is null)),
  check (bp is null or bp_range is null or (bp >= bp_range[1] and bp <= bp_range[2])),
  check ((lat is null) = (lon is null))
);
create index if not exists posts_feed on public.posts (group_id, created_at desc);
create index if not exists posts_member on public.posts (group_id, user_id, species_id);

create table if not exists public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- A catch cannot be dated far in the past or in the future (a photo from the gallery keeps its own date, up to a year back).
create or replace function public.posts_sanity() returns trigger language plpgsql as $$
begin
  if new.caught_at < now() - interval '1 year' or new.caught_at > now() + interval '1 day' then
    raise exception 'the date of the catch is not possible' using errcode = '22008';
  end if;
  return new;
end $$;
drop trigger if exists posts_sanity on public.posts;
create trigger posts_sanity before insert on public.posts for each row execute function public.posts_sanity();

-- ---------- Who is in a group ----------

create or replace function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where group_id = gid and user_id = auth.uid())
$$;

create or replace function public.is_admin(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where group_id = gid and user_id = auth.uid() and is_admin)
$$;

-- The group id at the start of a storage path "<group>/<user>/<file>", or null when the path is not like that.
create or replace function public.path_group(path text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(path, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- ---------- Row-level security ----------

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.posts enable row level security;
alter table public.reactions enable row level security;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using (public.is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member(group_id));
drop policy if exists members_update_own on public.members;
create policy members_update_own on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.members from authenticated;
grant update (nickname, color) on public.members to authenticated;

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to authenticated using (public.is_member(group_id));
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated with check (user_id = auth.uid() and public.is_member(group_id));
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using (user_id = auth.uid() or public.is_admin(group_id));

drop policy if exists reactions_read on public.reactions;
create policy reactions_read on public.reactions for select to authenticated using (exists (select 1 from public.posts p where p.id = post_id));
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));
drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions for delete to authenticated using (user_id = auth.uid());

-- Groups and members are changed only by the functions below (they check the founder code, the invite code, who is admin).
revoke insert, delete, truncate on public.groups, public.members from authenticated, anon;
revoke update, delete, truncate on public.groups from authenticated, anon;
revoke update on public.posts from authenticated, anon;
revoke all on public.groups, public.members, public.posts, public.reactions from anon;

-- ---------- Pictures and clips: a private bucket, "<group>/<user>/<catch>.<ext>" ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posts', 'posts', false, 2097152, array['image/jpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists posts_files_read on storage.objects;
create policy posts_files_read on storage.objects for select to authenticated
  using (bucket_id = 'posts' and public.is_member(public.path_group(name)));
drop policy if exists posts_files_insert on storage.objects;
create policy posts_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'posts' and split_part(name, '/', 2) = auth.uid()::text and public.is_member(public.path_group(name)));
drop policy if exists posts_files_delete on storage.objects;
create policy posts_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'posts' and (split_part(name, '/', 2) = auth.uid()::text or public.is_admin(public.path_group(name))));

-- ---------- Making, joining and leaving a group ----------

create or replace function public.create_group(p_secret text, p_name text, p_nickname text, p_color text)
returns table (group_id uuid, code text)
language plpgsql security definer set search_path = public, extensions, private as $$
declare
  v_code text;
  v_gid uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if encode(digest(upper(btrim(coalesce(p_secret, ''))), 'sha256'), 'hex') is distinct from (select value from private.config where key = 'founder_code_sha256') then
    raise exception 'wrong founder code' using errcode = '28P01';
  end if;
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups g where g.code = v_code);
  end loop;
  insert into public.groups (name, code, created_by) values (btrim(p_name), v_code, auth.uid()) returning id into v_gid;
  insert into public.members (group_id, user_id, nickname, color, is_admin) values (v_gid, auth.uid(), btrim(p_nickname), coalesce(p_color, '#1596D8'), true);
  return query select v_gid, v_code;
end $$;

create or replace function public.join_group(p_code text, p_nickname text, p_color text)
returns table (group_id uuid, group_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_group public.groups;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into v_group from public.groups g where g.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'no such group' using errcode = 'P0002'; end if;
  if (select count(*) from public.members m where m.group_id = v_group.id) >= 60 and not exists (select 1 from public.members m where m.group_id = v_group.id and m.user_id = auth.uid()) then
    raise exception 'the group is full' using errcode = '53400';
  end if;
  insert into public.members (group_id, user_id, nickname, color)
  values (v_group.id, auth.uid(), btrim(p_nickname), coalesce(p_color, '#1596D8'))
  on conflict (group_id, user_id) do update set nickname = excluded.nickname, color = excluded.color;
  return query select v_group.id, v_group.name;
exception when unique_violation then
  raise exception 'the nickname is taken' using errcode = '23505';
end $$;

-- Leaves a group: the member and, with it, all their posts. The app deletes their pictures first. The last admin passes the key
-- to the oldest member; the last member closes the group.
create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_was_admin boolean;
begin
  select is_admin into v_was_admin from public.members where group_id = p_group and user_id = auth.uid();
  if not found then return; end if;
  delete from public.members where group_id = p_group and user_id = auth.uid();
  if not exists (select 1 from public.members where group_id = p_group) then
    delete from public.groups where id = p_group;
  elsif v_was_admin and not exists (select 1 from public.members where group_id = p_group and is_admin) then
    update public.members set is_admin = true
    where (group_id, user_id) = (select group_id, user_id from public.members where group_id = p_group order by joined_at limit 1);
  end if;
end $$;

create or replace function public.remove_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_group) then raise exception 'only the admin can remove a member' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'use leave_group' using errcode = '22023'; end if;
  delete from public.members where group_id = p_group and user_id = p_user;
end $$;

-- ---------- The feed ----------

create or replace function public.group_feed(p_group uuid, p_before timestamptz default null, p_limit integer default 20, p_user uuid default null, p_new_only boolean default false)
returns table (
  id uuid, user_id uuid, nickname text, color text, catch_id text, species_id text, method text, confidence real,
  bp integer, bp_base integer, bp_range integer[], bp_factors real[], caught_at timestamptz, place_name text,
  lat double precision, lon double precision, media_path text, media_kind text, created_at timestamptz,
  reactions bigint, i_reacted boolean, new_for_user boolean, first_in_group boolean
)
language sql stable security invoker set search_path = public as $$
  with page as (
    select p.*, m.nickname, m.color,
      not exists (select 1 from public.posts q where q.group_id = p.group_id and q.user_id = p.user_id and q.species_id = p.species_id and (q.created_at, q.id) < (p.created_at, p.id)) as new_for_user,
      not exists (select 1 from public.posts q where q.group_id = p.group_id and q.species_id = p.species_id and (q.created_at, q.id) < (p.created_at, p.id)) as first_in_group
    from public.posts p
    join public.members m on m.group_id = p.group_id and m.user_id = p.user_id
    where p.group_id = p_group
      and (p_before is null or p.created_at < p_before)
      and (p_user is null or p.user_id = p_user)
  )
  select pg.id, pg.user_id, pg.nickname, pg.color, pg.catch_id, pg.species_id, pg.method, pg.confidence,
    pg.bp, pg.bp_base, pg.bp_range, pg.bp_factors, pg.caught_at, pg.place_name, pg.lat, pg.lon, pg.media_path, pg.media_kind, pg.created_at,
    (select count(*) from public.reactions r where r.post_id = pg.id),
    exists (select 1 from public.reactions r where r.post_id = pg.id and r.user_id = auth.uid()),
    pg.new_for_user, pg.first_in_group
  from page pg
  where (not p_new_only or pg.new_for_user)
  order by pg.created_at desc, pg.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- ---------- The leaderboards ----------
-- p_board: species (different species), strongest (the highest BP of one bird), catches (how many), streak (the longest run of days).
-- Every member is listed, also with 0. p_since limits it to catches since that moment (a week, a month).

create or replace function public.group_leaderboard(p_group uuid, p_board text, p_since timestamptz default null)
returns table (user_id uuid, nickname text, color text, value bigint, species_id text)
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_member(p_group) then raise exception 'not a member' using errcode = '42501'; end if;
  if p_board = 'species' then
    return query
      select m.user_id, m.nickname, m.color, count(distinct p.species_id), null::text
      from public.members m left join public.posts p on p.group_id = m.group_id and p.user_id = m.user_id and (p_since is null or p.caught_at >= p_since)
      where m.group_id = p_group group by m.user_id, m.nickname, m.color order by 4 desc, m.nickname;
  elsif p_board = 'catches' then
    return query
      select m.user_id, m.nickname, m.color, count(p.id), null::text
      from public.members m left join public.posts p on p.group_id = m.group_id and p.user_id = m.user_id and (p_since is null or p.caught_at >= p_since)
      where m.group_id = p_group group by m.user_id, m.nickname, m.color order by 4 desc, m.nickname;
  elsif p_board = 'strongest' then
    return query
      select m.user_id, m.nickname, m.color, coalesce(best.bp, 0)::bigint, best.species_id
      from public.members m
      left join lateral (
        select p.bp, p.species_id from public.posts p
        where p.group_id = m.group_id and p.user_id = m.user_id and p.bp is not null and (p_since is null or p.caught_at >= p_since)
        order by p.bp desc, p.created_at limit 1
      ) best on true
      where m.group_id = p_group order by 4 desc, m.nickname;
  elsif p_board = 'streak' then
    return query
      with days as (
        select distinct p.user_id, (p.caught_at at time zone 'Europe/Prague')::date as day
        from public.posts p where p.group_id = p_group and (p_since is null or p.caught_at >= p_since)
      ),
      numbered as (
        select d.user_id, d.day - (dense_rank() over (partition by d.user_id order by d.day))::int as run_id from days d
      ),
      runs as (
        select n.user_id, count(*) as len from numbered n group by n.user_id, n.run_id
      )
      select m.user_id, m.nickname, m.color, coalesce(max(r.len), 0)::bigint, null::text
      from public.members m left join runs r on r.user_id = m.user_id
      where m.group_id = p_group group by m.user_id, m.nickname, m.color order by 4 desc, m.nickname;
  else
    raise exception 'unknown board' using errcode = '22023';
  end if;
end $$;

create or replace function public.ping() returns timestamptz language sql stable as $$ select now() $$;

-- ---------- Who may call what ----------

revoke all on function public.create_group(text, text, text, text), public.join_group(text, text, text), public.leave_group(uuid),
  public.remove_member(uuid, uuid), public.group_feed(uuid, timestamptz, integer, uuid, boolean), public.group_leaderboard(uuid, text, timestamptz),
  public.is_member(uuid), public.is_admin(uuid) from public, anon;
grant execute on function public.create_group(text, text, text, text), public.join_group(text, text, text), public.leave_group(uuid),
  public.remove_member(uuid, uuid), public.group_feed(uuid, timestamptz, integer, uuid, boolean), public.group_leaderboard(uuid, text, timestamptz),
  public.is_member(uuid), public.is_admin(uuid) to authenticated;
grant execute on function public.ping() to anon, authenticated;
