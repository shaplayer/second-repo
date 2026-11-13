import { normalizeEmail } from "@/lib/auth/accounts";
import { teamInbox } from "@/lib/config";
import { db } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { allow, LIMITS } from "@/lib/limits";
import { clientIp, json, readJson, sameOrigin } from "@/lib/web/request";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const PACKAGES = ["Featured news", "Sponsored alert", "Campaign"];

/** The "Talk to us" form on the page for public companies. Saved first, then the team is emailed. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false }, 403);
  const body = await readJson(req);
  // A field people never see: only scripts fill it in.
  if (text(body.website, 200)) return json({ ok: true });
  const name = text(body.name, 120);
  const company = text(body.company, 160);
  const email = normalizeEmail(body.email);
  const phone = text(body.phone, 40);
  if (!name || !company) return json({ ok: false, error: "Please give your name and your company." }, 400);
  if (!email) return json({ ok: false, error: "That email address doesn't look right." }, 400);
  if (phone && !/^[+()\d\s.-]{7,25}$/.test(phone)) return json({ ok: false, error: "That phone number doesn't look right." }, 400);
  const ip = await clientIp();
  const pool = db();
  if (!(await allow(pool, LIMITS.inquiryPerVisitor, ip ?? "unknown"))) {
    return json({ ok: false, error: "We've had several messages from you already. We'll reply soon." }, 429);
  }
  const pkg = PACKAGES.includes(text(body.package, 40)) ? text(body.package, 40) : null;
  const message = text(body.message, 4000) || null;
  const ticker = text(body.ticker, 12).toUpperCase() || null;
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.inquiries (name, company, ticker, email, phone, package, message, ip) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text as id`,
    [name, company, ticker, email, phone || null, pkg, message, ip],
  );
  const to = teamInbox();
  if (to.length) {
    try {
      await emailProvider().send({
        to, replyTo: email, subject: `Sponsor inquiry: ${company}${ticker ? ` (${ticker})` : ""}`,
        text: [`Name: ${name}`, `Company: ${company}`, `Ticker: ${ticker ?? "-"}`, `Email: ${email}`, `Phone: ${phone || "-"}`, `Interested in: ${pkg ?? "-"}`, "", message ?? ""].join("\n"),
      });
      await pool.query(`update public.inquiries set notified_at = now() where id = $1`, [rows[0].id]);
    } catch (e) {
      // The inquiry is saved; the worker tries the notification again later.
      console.error("[inquiry] could not notify the team:", (e as Error).message);
    }
  }
  return json({ ok: true });
}
