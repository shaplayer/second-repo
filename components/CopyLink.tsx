"use client";
import { useState } from "react";

export function CopyLink({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={className}
      onClick={async () => {
        try { await navigator.clipboard.writeText(window.location.href.split("?")[0]); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
      }}>
      {copied ? "✓ Link copied" : "Copy page link"}
    </button>
  );
}
