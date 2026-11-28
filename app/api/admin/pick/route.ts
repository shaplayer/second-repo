import { createPick, updateScheduledPick, PickInputError, PickNotEditableError } from "@/lib/data/picks";
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
  if (typeof b.sponsored !== "boolean") return json({ ok: false, error: "Say whether the pick is sponsored." }, 400);
  if (b.id !== undefined && typeof b.id !== "string") return json({ ok: false, error: "Invalid pick ID." }, 400);
  const sponsored = b.sponsored === true;
  try {
    const input = {
      ticker: text(b.ticker, 12), title: text(b.title, 200), why: text(b.why, 2000), author: user.displayName ?? "BigStocks",
      sourceUrl: text(b.sourceUrl, 500) || null, ownsShares: b.ownsShares === true, ownershipNote: text(b.ownershipNote, 300),
      ...(sponsored
        ? { sponsored: true as const, sponsor: { payer: text(b.payer, 160), amount: text(b.amount, 80), form: text(b.form, 80) }, startDate: text(b.startDate, 20) }
        : { sponsored: false as const }),
    };
    const pick = typeof b.id === "string" ? await updateScheduledPick(db(), b.id, input) : await createPick(db(), input);
    return json({ ok: true, id: pick.id, ticker: pick.ticker, startsAt: pick.startsAt });
  } catch (e) {
    if (e instanceof PickInputError) return json({ ok: false, error: e.message }, 400);
    if (e instanceof PickNotEditableError) return json({ ok: false, error: e.message }, 409);
    console.error("[admin] could not save pick:", e);
    return json({ ok: false, error: "Could not save the pick." }, 500);
  }
}
