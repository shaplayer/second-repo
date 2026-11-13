/**
 * Insider trades arrive in bursts: when a company hands out its yearly stock awards, eight or ten of its
 * executives each file their own report in the same few minutes. Shown one by one they push everything
 * else off the list, so the lists show a burst as one row that opens (owner's decision, Nov 13, 2026).
 *
 * Pure: no network, no database. Used by the feed lists in the browser.
 */
import type { FeedItem } from "./data/feed";

export type FeedEntry =
  | { kind: "item"; item: FeedItem }
  | { kind: "insiders"; key: string; items: FeedItem[] };

/** Reports from the same company count as one burst while each is within this long of the one before it. */
export const INSIDER_GROUP_MINUTES = 60;

const companyKey = (it: FeedItem) => (it.cik !== null ? `c${it.cik}` : `n${it.company.toLowerCase()}`);

/**
 * The list with each company's burst of insider trades folded into one entry, placed where its newest
 * report was. `items` is newest first, as the feed gives it. A single insider trade stays an ordinary row.
 */
export function groupInsiderTrades(items: readonly FeedItem[], windowMinutes = INSIDER_GROUP_MINUTES): FeedEntry[] {
  const out: FeedEntry[] = [];
  const open = new Map<string, { at: number; oldest: number; items: FeedItem[] }>();
  for (const it of items) {
    if (it.category !== "insider") {
      out.push({ kind: "item", item: it });
      continue;
    }
    const key = companyKey(it);
    const time = Date.parse(it.publishedAt);
    const group = open.get(key);
    if (group && Math.abs(group.oldest - time) <= windowMinutes * 60_000) {
      group.items.push(it);
      group.oldest = time;
      continue;
    }
    const started = { at: out.length, oldest: time, items: [it] };
    open.set(key, started);
    out.push({ kind: "insiders", key: `g:${it.id}`, items: started.items });
  }
  return out.map((e) => (e.kind === "insiders" && e.items.length === 1 ? { kind: "item", item: e.items[0] } : e));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The headline and one line of detail for a burst. Says what happened, never what to do: "bought" and
 * "sold" here are what the insiders reported, in the past tense.
 */
export function insiderGroupText(items: readonly FeedItem[]): { headline: string; breakdown: string; detail: string } {
  let bought = 0;
  let sold = 0;
  for (const it of items) {
    const text = it.headline;
    if (/\bbought\b/i.test(text)) bought++;
    else if (/\bsold\b/i.test(text)) sold++;
  }
  const other = items.length - bought - sold;
  const parts: string[] = [];
  if (bought) parts.push(`${bought} bought on the open market`);
  if (sold) parts.push(`${sold} sold on the open market`);
  if (other) parts.push(bought || sold ? `${other} through awards or other transfers` : "All through stock awards or other transfers, not open-market trades");
  const breakdown = parts.join(" · ");
  return {
    headline: `${plural(items.length, "insider", "insiders")} reported trades`,
    breakdown,
    detail: `${breakdown}. Open to see each one.`,
  };
}
