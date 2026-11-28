-- Existing keys remain valid; the table is shared by API endpoints.
alter table public.pick_api_keys rename to api_keys;
revoke all on public.api_keys from anon, authenticated;

-- Keep old application instances working while the new code is deployed.
create view public.pick_api_keys as select * from public.api_keys;
revoke all on public.pick_api_keys from public, anon, authenticated;
