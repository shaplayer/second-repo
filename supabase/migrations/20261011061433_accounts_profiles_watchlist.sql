-- One profile per signed-in user. Plan and trial fields are only changed by the server (service role).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'member')),
  member_until timestamptz,
  l2_trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

-- Create the profile automatically when someone signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Watchlist: each user's followed stocks.
create table public.watchlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z.]{1,8}$'),
  added_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.watchlist enable row level security;

create policy "Users can read their own watchlist"
  on public.watchlist for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add to their own watchlist"
  on public.watchlist for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can remove from their own watchlist"
  on public.watchlist for delete to authenticated
  using ((select auth.uid()) = user_id);
