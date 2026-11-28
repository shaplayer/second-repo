import type { Client, Pool, PoolClient } from "pg";
import { randomToken, sha256Hex } from "./secret";

type Db = Pool | PoolClient | Client;

export async function createApiKey(db: Db, name: string, userId: string): Promise<string> {
  const key = randomToken();
  await db.query(
    `insert into public.api_keys (key_hash, name, created_by) values ($1, $2, $3)`,
    [sha256Hex(key), name, userId],
  );
  return key;
}

export async function authenticateApiKey(db: Db, authorization: string | null): Promise<string | null> {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
  if (!match) return null;
  const { rows } = await db.query<{ name: string }>(
    `select name from public.api_keys where key_hash = $1`,
    [sha256Hex(match[1])],
  );
  return rows[0]?.name ?? null;
}
