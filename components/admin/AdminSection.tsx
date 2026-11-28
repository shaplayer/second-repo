"use client";

import { QueryErrorResetBoundary, useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import { adminOptions, type AdminData } from "@/lib/admin-query";
import { AdminErrorBoundary } from "./AdminErrorBoundary";

type SectionProps<K extends keyof AdminData> = {
  title: string; section: K;
  children: (data: AdminData[K], query: UseSuspenseQueryResult<AdminData[K], Error>) => React.ReactNode;
};

function SectionData<K extends keyof AdminData>({ title, section, children }: SectionProps<K>) {
  const query = useSuspenseQuery(adminOptions(section));
  return (
    <>
      {query.isError && <p role="alert" className="m-0 text-sm text-bad">
        Could not load {title.toLowerCase()}. Showing the last loaded data.
        <button className="btn btn-soft ml-3" onClick={() => void query.refetch()}>Try again</button>
      </p>}
      {children(query.data, query)}
    </>
  );
}

export function AdminSection<K extends keyof AdminData>(props: SectionProps<K>) {
  const { title } = props;
  return (
    <section className="card flex flex-col gap-3 p-5 md:p-6">
      <h2 className="m-0 text-xl font-extrabold">{title}</h2>
      <QueryErrorResetBoundary>{({ reset }) => (
        <AdminErrorBoundary onReset={reset} fallback={(retry) => (
          <p role="alert" className="m-0 text-sm text-bad">
            Could not load {title.toLowerCase()}.
            <button className="btn btn-soft ml-3" onClick={retry}>Try again</button>
          </p>
        )}>
          <SectionData {...props} />
        </AdminErrorBoundary>
      )}</QueryErrorResetBoundary>
    </section>
  );
}
