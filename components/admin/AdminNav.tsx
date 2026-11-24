"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/picks", label: "Picks" },
  { href: "/admin/worker", label: "Worker & test email" },
  { href: "/admin/api-keys", label: "API keys" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Staff sections" className="flex flex-wrap gap-2">
      {links.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}
          className={`btn ${pathname === href ? "btn-dark" : "btn-soft"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
