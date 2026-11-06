"use client";
import { useEffect, useState } from "react";
import { formatET, timeAgo } from "@/lib/format";

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time dateTime={iso} title={formatET(iso)} className={className} suppressHydrationWarning>
      {now == null ? formatET(iso) : timeAgo(iso, now)}
    </time>
  );
}
