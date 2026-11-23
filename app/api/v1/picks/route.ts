import { authenticateApiKey } from "@/lib/auth/api-keys";
import { createPick, listPicks, PickInputError } from "@/lib/data/picks";
import { db } from "@/lib/db";
import { json, readJson, sameOrigin } from "@/lib/web/request";

export async function GET(req: Request) {
  try {
    if (!await authenticateApiKey(db(), req.headers.get("authorization"))) {
      return json({ ok: false, error: "Invalid API key." }, 401);
    }
    return json({ ok: true, picks: await listPicks(db(), { limit: null, includeScheduled: true }) });
  } catch (error) {
    console.error("[pick API] could not list picks:", error);
    return json({ ok: false, error: "Could not load picks." }, 500);
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "Request origin not allowed." }, 403);
  try {
    const name = await authenticateApiKey(db(), req.headers.get("authorization"));
    if (!name) return json({ ok: false, error: "Invalid API key." }, 401);
    const b = await readJson(req);
    if (b.confirm !== true || typeof b.ticker !== "string" || typeof b.title !== "string"
      || typeof b.sponsored !== "boolean" || typeof b.ownsShares !== "boolean"
      || (b.why !== undefined && typeof b.why !== "string")
      || (b.sourceUrl !== undefined && typeof b.sourceUrl !== "string")
      || (b.ownershipNote !== undefined && typeof b.ownershipNote !== "string")
      || (b.sponsored && (typeof b.payer !== "string" || typeof b.amount !== "string" || typeof b.form !== "string" || typeof b.startDate !== "string"))) {
      return json({ ok: false, error: "Invalid pick details or missing confirmation." }, 400);
    }
    if (b.ticker.length > 12 || b.title.length > 200 || (typeof b.why === "string" && b.why.length > 2000)
      || (typeof b.sourceUrl === "string" && b.sourceUrl.length > 500)
      || (typeof b.ownershipNote === "string" && b.ownershipNote.length > 300)
      || (typeof b.payer === "string" && b.payer.length > 160)
      || (typeof b.amount === "string" && b.amount.length > 80)
      || (typeof b.form === "string" && b.form.length > 80)) {
      return json({ ok: false, error: "Pick details are too long." }, 400);
    }
    const pick = await createPick(db(), {
      ticker: b.ticker, title: b.title, why: typeof b.why === "string" ? b.why : "", author: name,
      sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : null,
      ownsShares: b.ownsShares, ownershipNote: typeof b.ownershipNote === "string" ? b.ownershipNote : "",
      ...(b.sponsored && typeof b.payer === "string" && typeof b.amount === "string" && typeof b.form === "string" && typeof b.startDate === "string"
        ? { sponsored: true, sponsor: { payer: b.payer, amount: b.amount, form: b.form }, startDate: b.startDate }
        : { sponsored: false }),
    });
    return json({ ok: true, id: pick.id, ticker: pick.ticker, startsAt: pick.startsAt });
  } catch (error) {
    if (error instanceof PickInputError) return json({ ok: false, error: error.message }, 400);
    console.error("[pick API] could not create pick:", error);
    return json({ ok: false, error: "Could not create the pick." }, 500);
  }
}
