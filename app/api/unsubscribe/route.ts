import { undoUnsubscribe, unsubscribe, type UnsubscribeScope } from "@/lib/alerts/subscriptions";
import { db } from "@/lib/db";
import { json } from "@/lib/web/request";

const SCOPES: UnsubscribeScope[] = ["this", "stocks", "picks", "all"];

/**
 * Unsubscribing. Two callers:
 *  - a mail app's own "Unsubscribe" button (RFC 8058): a POST straight to this address with the code
 *    in the link and no page involved. It stops what that email was about, at once.
 *  - our unsubscribe page, after the person chose what to stop (or pressed "Undo").
 * The code in the link is the proof; no sign-in and no other check is asked for, by design: stopping
 * email must never be hard.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let token = url.searchParams.get("token") ?? "";
  let scope = url.searchParams.get("scope") ?? "this";
  let undo = "";
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    token = typeof body.token === "string" ? body.token : token;
    scope = typeof body.scope === "string" ? body.scope : scope;
    undo = typeof body.undo === "string" ? body.undo : "";
  }
  const pool = db();
  if (undo) return json({ ok: true, restored: await undoUnsubscribe(pool, undo) });
  if (!SCOPES.includes(scope as UnsubscribeScope)) scope = "this";
  const done = await unsubscribe(pool, token, scope as UnsubscribeScope);
  // An unknown code gets the same calm answer: nothing to stop.
  if (!done) return json({ ok: true, stopped: 0 });
  return json({ ok: true, stopped: done.stopped, undo: done.undoToken });
}
