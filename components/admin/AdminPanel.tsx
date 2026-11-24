"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { adminOptions, AdminRequestError, type AdminData } from "@/lib/admin-query";
import { HeaderView } from "@/components/site/HeaderView";
import { Footer } from "@/components/site/Footer";
import { AdminNav } from "./AdminNav";
import { AdminPanelSkeleton, AdminStaffSkeleton } from "./AdminSkeleton";

const routeSections: Record<string, (keyof AdminData)[]> = {
  "/admin": ["config", "jobs", "counts", "inquiries"],
  "/admin/picks": ["list-size", "scheduled-picks", "picks"],
  "/admin/worker": ["jobs", "test-alerts"],
};

function AdminContent({ children, pathname }: { children: React.ReactNode; pathname: string }) {
  const client = useQueryClient();
  useEffect(() => {
    for (const section of routeSections[pathname] ?? []) {
      void client.prefetchQuery(adminOptions(section));
    }
  }, [client, pathname]);
  return <Suspense key={pathname} fallback={<AdminStaffSkeleton pathname={pathname} />}>
    <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">Staff</h1>
    <AdminNav />
    <p className="fine m-0">Data refreshes every 30 seconds.</p>
    {children}
  </Suspense>;
}

export default function AdminPanel({ children }: { children: React.ReactNode }) {
  const client = useQueryClient();
  const session = useQuery(adminOptions("session"));
  const pathname = usePathname();
  const router = useRouter();
  const denied = session.error instanceof AdminRequestError && [401, 403].includes(session.error.status);
  useEffect(() => {
    if (!denied) return;
    client.removeQueries({ queryKey: ["admin"], predicate: (query) => query.queryKey[1] !== "session" });
    if (session.error instanceof AdminRequestError && session.error.status === 401) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    }
  }, [denied, session.error, client, router, pathname]);
  if (session.isPending) return <AdminPanelSkeleton pathname={pathname} />;
  return (
    <div className="page flex flex-col">
      <HeaderView user={Boolean(session.data) && !denied} />
      <main id="main" className="flex-1">
        <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 pb-14 pt-8 md:px-8">
          {session.isError ? <p role="alert" className="text-sm text-bad">
            {denied ? "Staff access is required." : "Could not check staff access. Please try again."}
            {!denied && <button className="btn btn-soft ml-3" onClick={() => void session.refetch()}>Try again</button>}
          </p> : <AdminContent pathname={pathname}>{children}</AdminContent>}
        </div>
      </main>
      <Footer />
    </div>
  );
}
