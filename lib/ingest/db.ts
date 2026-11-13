/** The one thing every writer here needs from a database handle: a pg Client, PoolClient or Pool all fit. */
import type { QueryResult, QueryResultRow } from "pg";

export type Db = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<R extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<R>>;
};

/** A short, single-line message fit for an error column or a log line. */
export const shortError = (e: unknown, max = 300): string =>
  String((e as Error)?.message ?? e).replace(/\s+/g, " ").trim().slice(0, max) || "unknown error";
