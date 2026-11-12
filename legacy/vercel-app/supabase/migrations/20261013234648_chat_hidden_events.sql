-- When a message is hidden, open chat boxes need to remove it. Hidden rows can't be sent out (security rules),
-- so a tiny public notice carrying only the message id is sent instead.
create table public.chat_hidden (
  message_id bigint primary key references public.chat_messages (id) on delete cascade,
  hidden_at timestamptz not null default now()
);
alter table public.chat_hidden enable row level security;
create policy "Anyone can see which messages were hidden"
  on public.chat_hidden for select to anon, authenticated using (true);

create function public.note_hidden_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hidden and not old.hidden then
    insert into public.chat_hidden (message_id) values (new.id) on conflict (message_id) do update set hidden_at = now();
  elsif not new.hidden and old.hidden then
    delete from public.chat_hidden where message_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.note_hidden_message() from public, anon, authenticated;

create trigger on_chat_message_hidden
  after update of hidden on public.chat_messages
  for each row execute function public.note_hidden_message();

alter publication supabase_realtime add table public.chat_hidden;
