create table public.pick_api_keys (
  key_hash text primary key,
  name text not null,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

alter table public.pick_api_keys enable row level security;
revoke all on public.pick_api_keys from anon, authenticated;
