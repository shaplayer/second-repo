"use client";

import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { FeedKind, FeedResponse } from "./types";

export type FeedFilter = { kind?: FeedKind | "all"; ticker?: string; forms?: string[]; q?: string };
type FeedRequest = FeedFilter & { limit: number; before?: string | null };

function normalized(filter: FeedRequest) {
  return {
    kind: filter.kind ?? "all", ticker: filter.ticker ?? "", q: filter.q ?? "",
    forms: filter.forms ?? [], limit: filter.limit, before: filter.before ?? null,
  };
}

async function fetchFeed(filter: FeedRequest, signal: AbortSignal): Promise<FeedResponse> {
  const f = normalized(filter);
  const params = new URLSearchParams({ kind: f.kind, limit: String(f.limit) });
  if (f.ticker) params.set("ticker", f.ticker);
  if (f.q) params.set("q", f.q);
  if (f.forms.length) params.set("forms", f.forms.join(","));
  if (f.before) params.set("before", f.before);
  const response = await fetch(`/api/feed?${params}`, { signal });
  if (!response.ok) throw new Error(`Feed request failed (${response.status}).`);
  return response.json();
}

export function feedQuery(filter: FeedRequest) {
  return queryOptions({
    queryKey: ["feed", normalized(filter)],
    queryFn: ({ signal }) => fetchFeed(filter, signal),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function feedPagesQuery(filter: FeedFilter) {
  const request = { ...filter, limit: 25 };
  return infiniteQueryOptions({
    queryKey: ["feed", "pages", normalized(request)],
    queryFn: ({ signal, pageParam }) => fetchFeed({ ...request, before: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: FeedResponse) => last.nextBefore ?? undefined,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
