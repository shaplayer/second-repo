import { NewsSourceInputError, parseNewsSourceUpdate, updateNewsSource } from "@/lib/data/news-sources";
import { db } from "@/lib/db";
import { currentUser, json, readJson, sameOrigin } from "@/lib/web/request";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "Request not allowed." }, 403);
  const user = await currentUser();
  if (!user?.isAdmin) return json({ ok: false, error: "Only staff can change news sources." }, 403);
  try {
    const update = parseNewsSourceUpdate(await readJson(req));
    const source = await updateNewsSource(db(), update);
    if (!source) return json({ ok: false, error: "This source changed or no longer exists. Reload it and try again." }, 409);
    return json({ ok: true, source });
  } catch (error) {
    if (error instanceof NewsSourceInputError) return json({ ok: false, error: error.message }, 400);
    console.error("[admin] could not save news source:", error);
    return json({ ok: false, error: "Could not save the news source." }, 500);
  }
}
