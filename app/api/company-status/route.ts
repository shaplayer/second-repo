import { getCompanyByCik } from "@/lib/data/companies";
import { db } from "@/lib/db";
import { json } from "@/lib/web/request";

/** Has the worker finished gathering a company's record and numbers? The stock page asks while it waits. */
export async function GET(req: Request) {
  const cik = Number(new URL(req.url).searchParams.get("cik"));
  const company = Number.isSafeInteger(cik) && cik > 0 ? await getCompanyByCik(db(), cik).catch(() => null) : null;
  if (!company) return json({ found: false }, 404);
  return json({ found: true, profileReady: company.profileReady, factsReady: company.factsReady });
}
