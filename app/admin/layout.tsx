import type { Metadata } from "next";
import { AdminClient } from "@/components/admin/AdminClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminClient>{children}</AdminClient>;
}
