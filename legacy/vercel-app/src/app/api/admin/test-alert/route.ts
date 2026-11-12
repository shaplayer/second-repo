import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { alertEmail, sendEmail } from "@/lib/email";
import { confirmedSubscribers, latestSummary } from "@/lib/store";

/** Send every confirmed subscriber's own inbox a sample alert built from the newest saved summary, to check how emails look. */
export async function POST(req: Request) {
  const authorized = (await isAdmin()) || req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!authorized || !process.env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [subs, latest] = await Promise.all([confirmedSubscribers(), latestSummary("4")]);
  if (!latest) return NextResponse.json({ error: "No summaries yet. Press “Explain this in plain English” on a filing first." }, { status: 400 });
  let sent = 0;
  for (const s of subs) {
    await sendEmail({ ...alertEmail(s, latest), subject: `[Test] ${alertEmail(s, latest).subject}` });
    sent++;
  }
  return NextResponse.json({ sent, sample: latest.headline });
}
