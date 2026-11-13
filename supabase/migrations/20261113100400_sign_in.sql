-- Sign-in by emailed link only (plan decision 14). The site sends the link itself, through the same
-- email service as the alerts, so there is one sender, one set of templates and nothing extra to set
-- up. Accounts are rows in public.users. People who signed up on the old app keep the same account:
-- they are found by their email address.

-- New accounts are no longer created by Supabase Auth, so the id no longer has to exist there.
alter table public.users drop constraint users_id_fkey;
alter table public.users alter column id set default gen_random_uuid();
alter table public.users add column last_sign_in_at timestamptz;

-- One account per email address. (The old app wrote an empty address for sign-ups without one.)
create unique index users_email_unique on public.users (lower(email)) where email <> '';

-- While the old app is still live, a sign-up there must never fail because the same address already
-- has an account here: skip the copy into public.users on any clash, not only on a clash of ids.
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
  on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- A sign-in link: works once, for a short time. Only a hash of the link's code is stored, so reading
-- this table does not let anyone sign in.
create table public.login_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null check (email = lower(email)),
  next_path text,                              -- where to go after signing in (a path on this site only)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  ip text
);
create index login_tokens_email on public.login_tokens (email, created_at desc);

-- A signed-in browser. The cookie holds a random code; only its hash is stored here.
create table public.sessions (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip text
);
create index sessions_user on public.sessions (user_id);
create index sessions_expiry on public.sessions (expires_at);

alter table public.login_tokens enable row level security;
alter table public.sessions enable row level security;
