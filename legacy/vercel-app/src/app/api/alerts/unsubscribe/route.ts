import { NextResponse } from "next/server";
import { deleteSubscriber } from "@/lib/store";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const unsubscribe = (token: string) => (token ? deleteSubscriber(token) : Promise.resolve(false));

/** Link in the email footer: show a page with a button, so email scanners that open links don't unsubscribe people. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return NextResponse.redirect(`${APP_URL}/alerts/manage?token=${encodeURIComponent(token)}&unsubscribe=1`);
}

/** One-click unsubscribe from the email app's own button (List-Unsubscribe-Post), and from our page. */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const ok = await unsubscribe(token);
  return NextResponse.json({ ok });
}
