-- Chat names are public; emails never are. Names are unique regardless of capitals.
alter table public.profiles add column chat_banned boolean not null default false;
create unique index profiles_display_name_unique on public.profiles (lower(display_name)) where display_name is not null;

-- Messages are written only by the server (which checks limits and finds $TICKERS); everyone can read visible ones.
create table public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  body text not null check (char_length(body) between 1 and 500),
  tickers text[] not null default '{}',
  hidden boolean not null default false,
  report_count int not null default 0,
  created_at timestamptz not null default now()
);
create index chat_messages_recent on public.chat_messages (created_at desc) where not hidden;
create index chat_messages_tickers on public.chat_messages using gin (tickers);
create index chat_messages_user on public.chat_messages (user_id, created_at desc);

alter table public.chat_messages enable row level security;

create policy "Anyone can read visible chat messages"
  on public.chat_messages for select to anon, authenticated
  using (not hidden);

-- One report per person per message.
create table public.chat_reports (
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, reporter_id)
);
create index chat_reports_reporter on public.chat_reports (reporter_id);
alter table public.chat_reports enable row level security;
-- No policies: only the server reads and writes reports.

-- Live updates for the chat box.
alter publication supabase_realtime add table public.chat_messages;
