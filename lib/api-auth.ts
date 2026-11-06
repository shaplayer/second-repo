import { timingSafeEqual } from "node:crypto";

/** Checks `Authorization: Bearer <ALERTS_API_KEY>` (min 16 chars). */
export function alertsKeyOk(req: Request): boolean {
  const key = process.env.ALERTS_API_KEY ?? "";
  if (key.length < 16) return false;
  const want = Buffer.from(`Bearer ${key}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return want.length === got.length && timingSafeEqual(want, got);
}
