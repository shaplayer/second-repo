-- Only the sign-up trigger should run this, never the public API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
