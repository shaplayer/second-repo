import { db } from "@/lib/db";
import { requestSummary } from "@/lib/summaries/jobs";
import { clientIp, json } from "@/lib/web/request";

/**
 * The summary for one item, when someone opens it. Answers from the database, or puts the item on
 * the worker's list and says "pending". This route never calls Claude or the SEC.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^(f:\d{10}-\d{2}-\d{6}|n:\d{1,18})$/.test(id)) return json({ status: "unavailable", reason: "We couldn't find that item." }, 400);
  try {
    const state = await requestSummary(db(), id, { visitor: await clientIp() });
    if (state.status === "ready") return json({ status: "ready", summary: state.item.summary, headline: state.item.headline });
    return json(state);
  } catch (e) {
    console.error("[summary]", (e as Error).message);
    return json({ status: "unavailable", reason: "Summaries are not available right now. The original has the full details." }, 503);
  }
}
