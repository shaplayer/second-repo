import { infiniteQueryOptions, queryOptions, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import type { FeedItem, FeedPage, FeedResult, FeedSummary } from "./data/feed";
import type { Category } from "./plain";

export type FeedFilters = {
  cik?: number;
  category: Category | "all";
  mine: boolean;
  text: string;
  limit: number;
  accountScope: string | null;
};

export type FeedData = InfiniteData<FeedPage, string | null>;
export type LiveFeed = { items: FeedItem[]; latestCursor: string | null; next: string | null };
export type SummaryView =
  | { status: "ready"; summary: FeedSummary; headline: string }
  | { status: "pending" }
  | { status: "unavailable"; reason: string };

export const feedKey = (filters: FeedFilters) => ["feed", filters] as const;
export const liveFeedKey = (filters: FeedFilters) => ["feed-live", filters] as const;
export const summaryKey = (id: string | null) => ["feed-summary", id] as const;

class FeedRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const retry = (count: number, error: Error) =>
  count < 2 && (!(error instanceof FeedRequestError) || error.status >= 500 || error.status === 429);
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

export async function fetchFeed(filters: FeedFilters, cursor: { before?: string; after?: string }, signal: AbortSignal): Promise<FeedResult> {
  const q = new URLSearchParams({ limit: String(filters.limit), ...cursor });
  if (filters.cik !== undefined) q.set("cik", String(filters.cik));
  if (filters.category !== "all") q.set("category", filters.category);
  if (filters.mine) q.set("mine", "1");
  if (filters.text) q.set("q", filters.text);
  const response = await fetch(`/api/feed?${q}`, { signal });
  if (!response.ok) throw new FeedRequestError("The feed is not available right now. Please try again.", response.status);
  return response.json();
}

export function feedOptions(filters: FeedFilters, initial?: FeedPage) {
  return infiniteQueryOptions({
    queryKey: feedKey(filters),
    queryFn: ({ pageParam, signal }): Promise<FeedPage> => fetchFeed(filters, pageParam ? { before: pageParam } : {}, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
    initialData: initial ? { pages: [initial], pageParams: [null] } : undefined,
    // Only the separate live query refreshes the top, so reading older pages never moves the list.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry,
    retryDelay,
  });
}

export function mergeFeedItems(...lists: readonly FeedItem[][]): FeedItem[] {
  const byId = new Map<string, FeedItem>();
  for (const list of lists) {
    for (const item of list) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((a, b) => a.cursor === b.cursor ? 0 : a.cursor > b.cursor ? -1 : 1);
}

export function prependFeed(data: FeedData, fresh: LiveFeed): FeedData {
  const first = data.pages[0];
  if (!first) return data;
  const seen = new Set<string>();
  const pages = data.pages.map((page, index) => {
    const items = index === 0 ? mergeFeedItems(fresh.items, page.items) : page.items;
    return {
      ...page,
      next: index === 0 && !first.items.length ? fresh.next : page.next,
      items: items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
    };
  });
  return { ...data, pages };
}

export async function refreshDiversifiedFeed(client: QueryClient, filters: FeedFilters): Promise<void> {
  const page = await client.fetchQuery({
    queryKey: ["feed-refresh", filters],
    queryFn: ({ signal }) => fetchFeed(filters, {}, signal),
    staleTime: 0,
  });
  client.setQueryData<FeedData>(feedKey(filters), { pages: [page], pageParams: [null] });
  client.setQueryData<LiveFeed>(liveFeedKey(filters), { items: [], latestCursor: page.latestCursor, next: page.next });
}

export async function fetchNewPosts(filters: FeedFilters, displayed: FeedData, previous: LiveFeed | undefined, signal: AbortSignal): Promise<LiveFeed> {
  let latestCursor = previous?.latestCursor ?? displayed.pages[0]?.items[0]?.cursor ?? null;
  let items = previous?.items ?? [];
  let next = previous?.next ?? null;
  let more: boolean;
  do {
    signal.throwIfAborted();
    const page = await fetchFeed(filters, latestCursor ? { after: latestCursor } : {}, signal);
    items = mergeFeedItems(page.items, items);
    if (!latestCursor) next = page.next;
    more = latestCursor !== null && page.hasMore;
    if (more && (!page.latestCursor || page.latestCursor === latestCursor)) {
      throw new Error("The live feed could not advance. Please try again.");
    }
    latestCursor = page.latestCursor ?? latestCursor;
  } while (more);
  const displayedIds = new Set(displayed.pages.flatMap((page) => page.items.map((item) => item.id)));
  return { items: items.filter((item) => !displayedIds.has(item.id)), latestCursor, next };
}

export function liveFeedOptions(client: QueryClient, filters: FeedFilters) {
  return queryOptions({
    queryKey: liveFeedKey(filters),
    queryFn: ({ signal }) => {
      const displayed = client.getQueryData<FeedData>(feedKey(filters));
      if (!displayed) throw new Error("The feed has not loaded yet.");
      return fetchNewPosts(filters, displayed, client.getQueryData<LiveFeed>(liveFeedKey(filters)), signal);
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry,
    retryDelay,
  });
}

export function summaryOptions(id: string | null, initial?: SummaryView) {
  return queryOptions({
    queryKey: summaryKey(id),
    queryFn: async ({ signal }): Promise<SummaryView> => {
      const response = await fetch(`/api/summary?id=${encodeURIComponent(id ?? "")}`, { signal });
      if (!response.ok) throw new FeedRequestError("Summaries are not available right now. Please try again or read the original.", response.status);
      return response.json();
    },
    initialData: initial,
    enabled: id !== null,
    staleTime: Infinity,
    refetchInterval: (query) => query.state.data?.status === "pending" && query.state.dataUpdateCount < 40 ? 3000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) => query.state.data?.status === "pending" && query.state.dataUpdateCount < 40 ? "always" : false,
    refetchOnReconnect: (query) => query.state.data?.status === "pending" && query.state.dataUpdateCount < 40 ? "always" : false,
    retry,
    retryDelay,
  });
}
