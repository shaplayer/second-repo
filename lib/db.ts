import { Pool } from "pg";

const g = globalThis as unknown as { __bsPool?: Pool };

export const hasDb = () => Boolean(process.env.DATABASE_URL);

export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!g.__bsPool) {
    g.__bsPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return g.__bsPool;
}
