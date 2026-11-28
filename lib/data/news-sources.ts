import type { Client, Pool, PoolClient } from "pg";

type Db = Pool | PoolClient | Client;

export type NewsSourceSettings = {
  enabled: boolean;
  can_store_body: boolean;
  can_summarize: boolean;
  terms_note: string | null;
};

export type NewsSource = NewsSourceSettings & { key: string; name: string };

export async function listNewsSources(db: Db): Promise<NewsSource[]> {
  return (await db.query<NewsSource>(
    `select key, name, enabled, can_store_body, can_summarize, terms_note
       from public.news_sources order by name, key`,
  )).rows;
}

function isSettings(value: unknown): value is NewsSourceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  return typeof s.enabled === "boolean" && typeof s.can_store_body === "boolean" &&
    typeof s.can_summarize === "boolean" && (typeof s.terms_note === "string" || s.terms_note === null);
}

export class NewsSourceInputError extends Error {}

export function parseNewsSourceUpdate(value: Record<string, unknown>): {
  key: string; settings: NewsSourceSettings; original: NewsSourceSettings;
} {
  const { key, settings, original } = value;
  if (typeof key !== "string" || !/^[a-z][a-z0-9_]{1,30}$/.test(key) ||
      !isSettings(settings) || !isSettings(original)) {
    throw new NewsSourceInputError("Invalid source settings.");
  }
  if (key === "sec") throw new NewsSourceInputError("The SEC source must stay on.");
  const note = settings.terms_note?.trim() || null;
  if (note && note.length > 10000) throw new NewsSourceInputError("The terms note is too long.");
  if ((settings.enabled || settings.can_store_body || settings.can_summarize) && !note) {
    throw new NewsSourceInputError("Add a terms note before enabling a source or allowing use of its text.");
  }
  return { key, settings: { ...settings, terms_note: note }, original };
}

export async function updateNewsSource(
  db: Db, update: ReturnType<typeof parseNewsSourceUpdate>,
): Promise<NewsSource | null> {
  const { key, settings, original } = update;
  const { rows } = await db.query<NewsSource>(
    `update public.news_sources
        set enabled = $2, can_store_body = $3, can_summarize = $4, terms_note = $5
      where key = $1 and key <> 'sec'
        and enabled = $6 and can_store_body = $7 and can_summarize = $8
        and terms_note is not distinct from $9
      returning key, name, enabled, can_store_body, can_summarize, terms_note`,
    [key, settings.enabled, settings.can_store_body, settings.can_summarize, settings.terms_note,
      original.enabled, original.can_store_body, original.can_summarize, original.terms_note],
  );
  return rows[0] ?? null;
}
