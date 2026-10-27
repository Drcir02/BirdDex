-- BirdDex group, part 2: the leaderboards and the profiles count everything a member has caught, the feed shows only what was caught
-- since joining. An older catch is sent as a "stats only" post (in_feed = false): species, BP and date, without a picture or a place,
-- and it never appears in the feed. Also an old photo from the gallery may be posted (the date of the catch is no longer limited to a year back).
-- Run after 001_group.sql (scripts/apply-supabase.mjs <project> supabase/migrations/002_group_totals.sql).

alter table public.posts add column if not exists in_feed boolean not null default true;

alter table public.posts drop constraint if exists posts_stats_only;
alter table public.posts add constraint posts_stats_only
  check (in_feed or (media_path is null and place_name is null and lat is null and lon is null));

-- The date of a catch: not before the year 2000 and not more than a day ahead.
create or replace function public.posts_sanity() returns trigger language plpgsql as $$
begin
  if new.caught_at < timestamptz '2000-01-01 00:00:00+00' or new.caught_at > now() + interval '1 day' then
    raise exception 'the date of the catch is not possible' using errcode = '22008';
  end if;
  return new;
end $$;

-- The feed: only posts that are in the feed, unless p_all asks for the stats-only ones as well (a member's page counts them).
-- The badges look at all posts, so a species a member had before joining is not "new" for them.
drop function if exists public.group_feed(uuid, timestamptz, integer, uuid, boolean);
create or replace function public.group_feed(p_group uuid, p_before timestamptz default null, p_limit integer default 20, p_user uuid default null, p_new_only boolean default false, p_all boolean default false)
returns table (
  id uuid, user_id uuid, nickname text, color text, catch_id text, species_id text, method text, confidence real,
  bp integer, bp_base integer, bp_range integer[], bp_factors real[], caught_at timestamptz, place_name text,
  lat double precision, lon double precision, media_path text, media_kind text, created_at timestamptz,
  reactions bigint, i_reacted boolean, new_for_user boolean, first_in_group boolean, in_feed boolean
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
      and (p_all or p.in_feed)
  )
  select pg.id, pg.user_id, pg.nickname, pg.color, pg.catch_id, pg.species_id, pg.method, pg.confidence,
    pg.bp, pg.bp_base, pg.bp_range, pg.bp_factors, pg.caught_at, pg.place_name, pg.lat, pg.lon, pg.media_path, pg.media_kind, pg.created_at,
    (select count(*) from public.reactions r where r.post_id = pg.id),
    exists (select 1 from public.reactions r where r.post_id = pg.id and r.user_id = auth.uid()),
    pg.new_for_user, pg.first_in_group, pg.in_feed
  from page pg
  where (not p_new_only or pg.new_for_user)
  order by pg.created_at desc, pg.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke all on function public.group_feed(uuid, timestamptz, integer, uuid, boolean, boolean) from public, anon;
grant execute on function public.group_feed(uuid, timestamptz, integer, uuid, boolean, boolean) to authenticated;
