import { NextResponse } from "next/server";
import { sendDigests } from "@/lib/alerts";

/** Called once a day (6 PM ET) to send "daily summary" emails. */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await sendDigests());
}
