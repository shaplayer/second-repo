"use client";

import { queryOptions } from "@tanstack/react-query";
import { createCompanySearch, parseCompanyResponse } from "./companies";

export const companyDirectoryQuery = queryOptions({
  queryKey: ["search", "company-directory"],
  queryFn: async ({ signal }) => {
    const response = await fetch("/api/search/companies", { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Company directory request failed (${response.status}).`);
    const directory = parseCompanyResponse(await response.json());
    return { ...createCompanySearch(directory.companies), stale: directory.stale };
  },
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  structuralSharing: false,
  retry: 1,
});
