import { NextResponse } from "next/server";
import { recentAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: await recentAlerts(10) });
}
