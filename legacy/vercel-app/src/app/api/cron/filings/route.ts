import { NextResponse } from "next/server";
import { pollFilings } from "@/lib/alerts";

export const maxDuration = 300;

/** Called every minute by the alert checker (scripts/alerts-worker.mjs locally, a scheduler in production). */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await pollFilings());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
