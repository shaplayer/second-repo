import "./load-env";
import { Pool } from "pg";
import { connectionConfig } from "../lib/db/connect";
import { runBenzingaStream } from "../lib/ingest/benzinga-stream";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = new Pool({ ...connectionConfig(process.env.DATABASE_URL), max: 2 });
  const stop = new AbortController();
  const onSignal = (signal: NodeJS.Signals) => {
    console.log(`[benzinga-stream] ${signal}: stopping`);
    stop.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    await runBenzingaStream(db, stop.signal);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await db.end();
  }
}

main().catch((error: Error) => {
  console.error("[benzinga-stream] worker stopped:", error.message);
  process.exitCode = 1;
});
