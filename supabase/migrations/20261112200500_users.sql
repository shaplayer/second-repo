-- Accounts. Replaces profiles: everyone who signs in is a free member, so there are no plan or billing
-- columns (plan decision 6). profiles stays as it is until the switch-over (Phase 6); the backfill copies
-- it here and can be run again.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  chat_banned boolean not null default false,
  is_admin boolean not null default false,     -- replaces the shared admin password
  created_at timestamptz not null default now()
);
-- Chat names are unique whatever the capitals, as before.
create unique index users_display_name_unique on public.users (lower(display_name)) where display_name is not null;

alter table public.users enable row level security;

create policy "Users can read their own account"
  on public.users for select to authenticated
  using ((select auth.uid()) = id);

-- New sign-ups get a row in both tables until profiles is retired.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  insert into public.users (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
