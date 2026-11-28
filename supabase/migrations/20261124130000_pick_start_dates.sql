-- Preserve the dates of existing picks, including imported disclosure records.
alter table public.picks add column starts_at timestamptz;
update public.picks set starts_at = posted_at;
alter table public.picks alter column starts_at set default now();
alter table public.picks alter column starts_at set not null;

create index picks_starts on public.picks (starts_at desc);
drop index public.picks_match_todo;
create index picks_match_todo on public.picks (starts_at) where matched_at is null and imported_from is null;
