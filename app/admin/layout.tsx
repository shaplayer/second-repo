import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/AdminNav";
import { Shell } from "@/components/site/Shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 pb-14 pt-8 md:px-8">
        <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">Staff</h1>
        <AdminNav />
        {children}
      </div>
    </Shell>
  );
}
