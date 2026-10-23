-- Verity accounts: one row of synced data per user (profile, portfolios, watchlist, alerts).
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
