import { queryOptions } from "@tanstack/react-query";
import type { StockPick } from "./data/picks";
import type { TestAlertJob } from "./alerts/test-alerts";
import type { NewsSource } from "./data/news-sources";

export type AdminData = {
  session: { id: string };
  counts: { picks: string; people: string; pending: string; queued: string; sent: string; failed: string; summaries: string };
  config: { problems: string[]; smsEnabled: boolean };
  jobs: { job: string; last_success_at: string | null; last_error: string | null; last_error_at: string | null }[];
  inquiries: { id: string; name: string; company: string; ticker: string | null; email: string; phone: string | null; package: string | null; message: string | null; created_at: string }[];
  "list-size": number;
  picks: StockPick[];
  "scheduled-picks": StockPick[];
  "test-alerts": TestAlertJob[];
  "news-sources": NewsSource[];
};

export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function fetchAdmin<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new AdminRequestError("Could not load staff data. Please try again.", response.status);
  return response.json();
}

export const adminKey = (section: keyof AdminData) => ["admin", section] as const;

const refreshOptions = {
  staleTime: 15_000,
  gcTime: 60_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: true,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  retry: (count: number, error: Error) => count < 2 && (!(error instanceof AdminRequestError) || error.status >= 500),
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
} as const;

export function adminOptions<K extends keyof AdminData>(section: K) {
  return queryOptions({
    ...refreshOptions,
    queryKey: adminKey(section),
    queryFn: ({ signal }) => fetchAdmin<AdminData[K]>(`/api/admin/data/${section}`, signal),
  });
}

export function recipientOptions(query: string | null) {
  return queryOptions({
    ...refreshOptions,
    queryKey: ["admin", "recipients", query] as const,
    queryFn: ({ signal }) => fetchAdmin<{ recipients: { id: string; address: string }[] }>(
      `/api/admin/test-alerts?q=${encodeURIComponent(query ?? "")}`, signal,
    ),
    enabled: query !== null,
  });
}
