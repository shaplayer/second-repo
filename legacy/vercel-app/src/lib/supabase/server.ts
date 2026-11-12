import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Supabase as the signed-in visitor (row-level security applies). For server components and route handlers. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(URL, PUBLISHABLE, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a server component, where cookies are read-only; middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Supabase with full access, for server-only jobs (sign-in emails, granting membership). Never send this to a browser. */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is missing from .env");
  return createPlainClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
