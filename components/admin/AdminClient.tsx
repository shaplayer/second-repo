"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AdminPanelSkeleton } from "./AdminSkeleton";

function AdminLoading() {
  return <AdminPanelSkeleton pathname={usePathname()} />;
}

const AdminPanel = dynamic(() => import("./AdminPanel"), {
  ssr: false,
  loading: AdminLoading,
});

export function AdminClient({ children }: { children: React.ReactNode }) {
  return <AdminPanel>{children}</AdminPanel>;
}
