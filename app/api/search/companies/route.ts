import { NextResponse } from "next/server";
import { getCompanyDirectory } from "@/lib/market/company-directory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getCompanyDirectory(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.error("[search] Company directory unavailable:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Company suggestions are temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
