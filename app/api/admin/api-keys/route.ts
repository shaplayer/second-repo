import { createApiKey } from "@/lib/auth/api-keys";
import { db } from "@/lib/db";
import { currentUser, json, readJson, sameOrigin } from "@/lib/web/request";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "Request origin not allowed." }, 403);
  const user = await currentUser();
  if (!user?.isAdmin) return json({ ok: false, error: "Only staff can create API keys." }, 403);
  const body = await readJson(req);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return json({ ok: false, error: "Enter a name of up to 100 characters." }, 400);
  try {
    const key = await createApiKey(db(), name, user.id);
    return json({ ok: true, key });
  } catch (error) {
    console.error("[API keys] could not create key:", error);
    return json({ ok: false, error: "Could not create the API key." }, 500);
  }
}
