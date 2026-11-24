import type { Pool, QueryResultRow } from "pg";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/web/request";

export async function requireAdmin(path: string) {
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  if (!user.isAdmin) notFound();
  return user;
}

export async function adminQuery<T extends QueryResultRow>(pool: Pool, name: string, sql: string): Promise<T[] | null> {
  try {
    return (await pool.query<T>(sql)).rows;
  } catch (error) {
    console.error(`[admin] could not load ${name}:`, error);
    return null;
  }
}
