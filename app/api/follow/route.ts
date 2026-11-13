import { SIGNED_IN_CONSENT } from "@/components/signup/consent";
import { followCompany, setStockAlerts, unfollowCompany } from "@/lib/data/account";
import { getCompanyByCik, getCompanyByTicker } from "@/lib/data/companies";
import { db } from "@/lib/db";
import { clientIp, currentUser, json, readJson, sameOrigin, userAgent } from "@/lib/web/request";

/**
 * A signed-in person's own stocks: add one, remove one, or switch its email alerts.
 * Body: { cik | ticker, remove?: true, alerts?: boolean, only?: "alerts" }
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false }, 403);
  const user = await currentUser();
  if (!user) return json({ ok: false, error: "Please sign in first.", signIn: true }, 401);
  const body = await readJson(req);
  const pool = db();
  const company =
    typeof body.cik === "number" ? await getCompanyByCik(pool, body.cik)
    : typeof body.ticker === "string" ? await getCompanyByTicker(pool, body.ticker)
    : null;
  if (!company) return json({ ok: false, error: "We couldn't find that company. Try its ticker, like AAPL." }, 404);
  const evidence = { consentText: SIGNED_IN_CONSENT, source: String(body.source ?? "my-stocks").slice(0, 80), ip: await clientIp(), userAgent: await userAgent() };
  if (body.remove === true) await unfollowCompany(pool, user, company.cik);
  else if (body.only === "alerts") await setStockAlerts(pool, user, company.cik, body.alerts !== false, evidence);
  else await followCompany(pool, user, company.cik, { ...evidence, alerts: body.alerts !== false });
  return json({ ok: true, cik: company.cik, ticker: company.ticker });
}
