import { createPick } from "@/lib/data/picks";
import { db } from "@/lib/db";
import { currentUser, json, readJson, sameOrigin } from "@/lib/web/request";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Staff post a pick. The worker then emails it to the pick list (within seconds).
 * A sponsored pick is refused unless it says who paid, how much and in what form.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false }, 403);
  const user = await currentUser();
  if (!user?.isAdmin) return json({ ok: false, error: "Only staff can post picks." }, 403);
  const b = await readJson(req);
  if (b.confirm !== true) return json({ ok: false, error: "Tick the box to confirm before sending." }, 400);
  const sponsored = b.sponsored === true;
  try {
    const pick = await createPick(db(), {
      ticker: text(b.ticker, 12), title: text(b.title, 200), why: text(b.why, 2000), author: user.displayName ?? "BigStocks",
      sourceUrl: text(b.sourceUrl, 500) || null, ownsShares: b.ownsShares === true, ownershipNote: text(b.ownershipNote, 300),
      sponsor: sponsored ? { payer: text(b.payer, 160), amount: text(b.amount, 80), form: text(b.form, 80) } : null,
    });
    return json({ ok: true, id: pick.id, ticker: pick.ticker });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
}
