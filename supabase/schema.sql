-- ONCAL accounts: one row of synced data per user (profile, portfolios, watchlist, alerts),
-- and the public Topluluk posts further down.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this file -> Run.
-- Running it again is safe (everything is "if not exists" / "or replace").
--
-- Security: row level security is on and every policy is "auth.uid() = user_id", so with the
-- public anon key a signed-in user can read and write only their own row, and an anonymous
-- visitor can read nothing.

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  rev        bigint      not null default 1,          -- optimistic lock: a write must name the rev it read
  updated_at timestamptz not null default now(),
  constraint user_data_size check (pg_column_size(data) < 2000000)   -- about 2 MB per user
);

alter table public.user_data enable row level security;

drop policy if exists "user_data own select" on public.user_data;
drop policy if exists "user_data own insert" on public.user_data;
drop policy if exists "user_data own update" on public.user_data;
drop policy if exists "user_data own delete" on public.user_data;

create policy "user_data own select" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_data own insert" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_data own update" on public.user_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_data own delete" on public.user_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- updated_at follows every write
create or replace function public.user_data_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch before update on public.user_data
  for each row execute function public.user_data_touch();

-- "Hesabımı sil" in the profile page: a user can delete their own account (and, through the
-- foreign key, their data row). security definer is needed to touch auth.users; the function
-- only ever deletes the caller.
create or replace function public.delete_my_account() returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Anonymous visitors get no access at all (RLS would already return nothing)
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Topluluk (assets/js/community.js): public posts. Everyone, signed in or not, can read; a
-- signed-in user can post, like and report, and delete only their own posts and likes. Posts are
-- never edited. At most 20 posts per user per hour; a post three users reported is hidden.

create table if not exists public.posts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author     text not null check (char_length(author) between 2 and 30),
  ticker     text check (ticker ~ '^[A-Z0-9]{2,8}$'),
  stance     text check (stance in ('al', 'sat', 'notr')),
  body       text not null check (char_length(body) between 3 and 1000),
  idea       text check (char_length(idea) <= 20000 and idea ~ '^[A-Za-z0-9_-]+$'),   -- chart idea (pro-chart.js)
  created_at timestamptz not null default now()
);
create index if not exists posts_created on public.posts (created_at desc);
create index if not exists posts_ticker on public.posts (ticker, created_at desc);
create index if not exists posts_user on public.posts (user_id, created_at desc);

create table if not exists public.post_likes (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists public.post_reports (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_reports enable row level security;

drop policy if exists "posts read" on public.posts;
drop policy if exists "posts own insert" on public.posts;
drop policy if exists "posts own delete" on public.posts;
create policy "posts read" on public.posts for select to anon, authenticated using (true);
create policy "posts own insert" on public.posts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "posts own delete" on public.posts for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "likes read" on public.post_likes;
drop policy if exists "likes own insert" on public.post_likes;
drop policy if exists "likes own delete" on public.post_likes;
create policy "likes read" on public.post_likes for select to anon, authenticated using (true);
create policy "likes own insert" on public.post_likes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "likes own delete" on public.post_likes for delete to authenticated using ((select auth.uid()) = user_id);

-- Who reported what stays private: a user sees only their own reports
drop policy if exists "reports own" on public.post_reports;
drop policy if exists "reports own insert" on public.post_reports;
create policy "reports own" on public.post_reports for select to authenticated using ((select auth.uid()) = user_id);
create policy "reports own insert" on public.post_reports for insert to authenticated with check ((select auth.uid()) = user_id);

-- Flood guard
create or replace function public.posts_rate_limit() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Saatte en fazla 20 paylaşım yapılabilir';
  end if;
  return new;
end $$;
drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit before insert on public.posts
  for each row execute function public.posts_rate_limit();

-- The feed: like counts, and posts with three or more reports left out. security definer so
-- the report count can be read without exposing who reported.
create or replace function public.community_feed(p_ticker text default null, p_tickers text[] default null,
                                                 p_sort text default 'new', p_limit int default 30, p_offset int default 0)
  returns table (id bigint, user_id uuid, author text, ticker text, stance text, body text, idea text,
                 created_at timestamptz, likes bigint)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.user_id, p.author, p.ticker, p.stance, p.body, p.idea, p.created_at,
         (select count(*) from public.post_likes l where l.post_id = p.id) as likes
  from public.posts p
  where (select count(*) from public.post_reports r where r.post_id = p.id) < 3
    and (p_ticker is null or p.ticker = p_ticker)
    and (p_tickers is null or p.ticker = any (p_tickers))
  order by case when p_sort = 'top' then (select count(*) from public.post_likes l where l.post_id = p.id) end desc nulls last,
           p.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;
grant execute on function public.community_feed(text, text[], text, int, int) to anon, authenticated;

grant select on public.posts, public.post_likes to anon, authenticated;
grant insert, delete on public.posts, public.post_likes to authenticated;
grant select, insert on public.post_reports to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Sanal Portföy Yarışması (assets/js/contest.js): every player starts with 100.000 TL of play
-- money. The database fills each order itself: the price comes from market_prices (written only
-- by scripts/update-prices.mjs with the service key), and a buy beyond the cash or a sell beyond
-- the lots held is refused, so the leaderboard cannot be faked from the browser.

create table if not exists public.market_prices (
  ticker     text primary key check (ticker ~ '^[A-Z0-9]{2,8}$'),
  price      numeric not null check (price > 0),
  updated_at timestamptz not null default now()
);
alter table public.market_prices enable row level security;
drop policy if exists "prices read" on public.market_prices;
create policy "prices read" on public.market_prices for select to anon, authenticated using (true);
grant select on public.market_prices to anon, authenticated;

create table if not exists public.paper_players (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  author     text not null check (char_length(author) between 2 and 30),
  started_at timestamptz not null default now()
);
alter table public.paper_players enable row level security;
drop policy if exists "players own" on public.paper_players;
drop policy if exists "players own insert" on public.paper_players;
drop policy if exists "players own update" on public.paper_players;
create policy "players own" on public.paper_players for select to authenticated using ((select auth.uid()) = user_id);
create policy "players own insert" on public.paper_players for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "players own update" on public.paper_players for update to authenticated using ((select auth.uid()) = user_id);
grant select on public.paper_players to authenticated;
grant insert (author) on public.paper_players to authenticated;
grant update (author) on public.paper_players to authenticated;

create table if not exists public.paper_trades (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker     text not null check (ticker ~ '^[A-Z0-9]{2,8}$'),
  side       text not null check (side in ('buy', 'sell')),
  qty        integer not null check (qty > 0 and qty <= 10000000),
  price      numeric,
  created_at timestamptz not null default now()
);
create index if not exists paper_trades_user on public.paper_trades (user_id, created_at desc);
alter table public.paper_trades enable row level security;
drop policy if exists "trades own" on public.paper_trades;
drop policy if exists "trades own insert" on public.paper_trades;
create policy "trades own" on public.paper_trades for select to authenticated using ((select auth.uid()) = user_id);
create policy "trades own insert" on public.paper_trades for insert to authenticated with check ((select auth.uid()) = user_id);
grant select on public.paper_trades to authenticated;
-- Only these three columns can be sent; the price and the time are the database's
grant insert (ticker, side, qty) on public.paper_trades to authenticated;

create or replace function public.paper_fill() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  p numeric;
  cash numeric;
  held bigint;
begin
  -- One order at a time per player, so two quick orders cannot both spend the same cash
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  if not exists (select 1 from public.paper_players where user_id = new.user_id) then
    raise exception 'Önce yarışmaya katılmalısın';
  end if;
  if (select count(*) from public.paper_trades where user_id = new.user_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Dakikada en fazla 20 emir verilebilir';
  end if;
  select price into p from public.market_prices where ticker = new.ticker and updated_at > now() - interval '5 days';
  if p is null then
    raise exception 'Bu hisse için güncel fiyat yok';
  end if;
  new.price := p;
  new.created_at := now();
  select 100000 - coalesce(sum(case when side = 'buy' then qty * price else -qty * price end), 0) into cash
    from public.paper_trades where user_id = new.user_id;
  select coalesce(sum(case when side = 'buy' then qty else -qty end), 0) into held
    from public.paper_trades where user_id = new.user_id and ticker = new.ticker;
  if new.side = 'buy' and new.qty * p > cash then
    raise exception 'Yetersiz nakit';
  end if;
  if new.side = 'sell' and new.qty > held then
    raise exception 'Elinde bu kadar lot yok';
  end if;
  return new;
end $$;
drop trigger if exists paper_fill on public.paper_trades;
create trigger paper_fill before insert on public.paper_trades
  for each row execute function public.paper_fill();

-- Start over: the caller's orders go, the clock restarts
create or replace function public.paper_reset() returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.paper_trades where user_id = auth.uid();
  update public.paper_players set started_at = now() where user_id = auth.uid();
end $$;
revoke all on function public.paper_reset() from public, anon;
grant execute on function public.paper_reset() to authenticated;

-- Leaderboard: cash plus the holdings at the latest prices, for everyone; is_me marks the caller
create or replace function public.paper_leaderboard(p_limit int default 50)
  returns table (rank bigint, author text, value numeric, ret numeric, trades bigint, started_at timestamptz, is_me boolean)
  language sql stable security definer set search_path = '' as $$
  with pos as (
    select user_id, ticker, sum(case when side = 'buy' then qty else -qty end) as q
    from public.paper_trades group by user_id, ticker
  ), money as (
    select user_id, 100000 - sum(case when side = 'buy' then qty * price else -qty * price end) as cash, count(*) as n
    from public.paper_trades group by user_id
  ), val as (
    select pl.user_id, pl.author, pl.started_at, coalesce(m.n, 0) as n,
           coalesce(m.cash, 100000) + coalesce((select sum(pos.q * mp.price) from pos join public.market_prices mp on mp.ticker = pos.ticker
                                                where pos.user_id = pl.user_id), 0) as v
    from public.paper_players pl left join money m on m.user_id = pl.user_id
  )
  select row_number() over (order by v desc, started_at), author, round(v, 2), round((v / 100000 - 1) * 100, 2), n, started_at,
         user_id = auth.uid()
  from val order by v desc, started_at
  limit least(greatest(p_limit, 1), 200);
$$;
grant execute on function public.paper_leaderboard(int) to anon, authenticated;
