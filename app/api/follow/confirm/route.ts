import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { site } from "@/lib/follow/messages";

export const dynamic = "force-dynamic";

/** Email double opt-in: GET /api/follow/confirm?t=<token> */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!hasDb() || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.redirect(`${site()}/news?follow=invalid`, 303);
  const { rows } = await db().query(
    `UPDATE ticker_follows SET confirmed_at = COALESCE(confirmed_at, now()), unsubscribed_at = NULL
      WHERE token = $1 AND channel = 'email' RETURNING ticker`,
    [token],
  );
  if (!rows[0]) return NextResponse.redirect(`${site()}/news?follow=invalid`, 303);
  return NextResponse.redirect(`${site()}/news/${encodeURIComponent(rows[0].ticker)}?follow=confirmed`, 303);
}
