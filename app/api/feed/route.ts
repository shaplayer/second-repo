import { watchlistCiks, alertCiks } from "@/lib/data/account";
import { getFeed } from "@/lib/data/feed";
import { db } from "@/lib/db";
import { CATEGORIES, type Category } from "@/lib/plain";
import { currentUser, json } from "@/lib/web/request";

/** One page of the feed for the live list: filters, "newer than", "older than". Reads the database only. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const category = q.get("category");
  const cik = Number(q.get("cik"));
  const pool = db();
  let ciks: number[] | undefined;
  if (q.get("mine") === "1") {
    const user = await currentUser();
    ciks = user ? [...new Set([...(await watchlistCiks(pool, user.id)), ...(await alertCiks(pool, user.email))])] : [];
  }
  try {
    const page = await getFeed(pool, {
      category: category && (CATEGORIES as readonly string[]).includes(category) ? (category as Category) : undefined,
      cik: Number.isSafeInteger(cik) && cik > 0 ? cik : undefined,
      ciks,
      text: q.get("q")?.slice(0, 80) || undefined,
      before: q.get("before") ?? undefined,
      after: q.get("after") ?? undefined,
      limit: Math.min(Number(q.get("limit")) || 30, 60),
    });
    return json(page);
  } catch (e) {
    console.error("[feed]", (e as Error).message);
    return json({ items: [], next: null, error: "The feed is not available right now." }, 503);
  }
}
