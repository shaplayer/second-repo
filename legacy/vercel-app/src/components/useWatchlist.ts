"use client";

import { useEffect, useState } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/universe";

// Signed-in users keep their watchlist in their account; visitors keep it in this browser.
const KEY = "bigstocks:watchlist";
const MERGED = "bigstocks:watchlist-merged";
const EVENT = "bigstocks:watchlist-changed";

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function writeLocal(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

let signedIn: boolean | null = null;
let cache: string[] | null = null;
let ready: Promise<string[]> | null = null; // first load; changes wait for it so they go to the right place

async function load(): Promise<string[]> {
  const res = await fetch("/api/watchlist").then((r) => r.json()).catch(() => ({ signedIn: false, tickers: [] }));
  signedIn = res.signedIn;
  if (!signedIn) return (cache = readLocal());
  // First sign-in on this browser: bring the browser's list into the account once.
  let merged = false;
  try {
    merged = localStorage.getItem(MERGED) === "1";
  } catch {}
  if (!merged) {
    const local = readLocal().filter((t) => !res.tickers.includes(t));
    if (local.length) await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: local }) });
    try {
      localStorage.setItem(MERGED, "1");
    } catch {}
    return (cache = [...res.tickers, ...local]);
  }
  return (cache = res.tickers);
}

const notify = () => window.dispatchEvent(new Event(EVENT));

export function useWatchlist() {
  const [list, setList] = useState<string[] | null>(cache);
  useEffect(() => {
    let live = true;
    const sync = () => live && setList(cache);
    (ready ??= load()).then(() => sync());
    window.addEventListener(EVENT, sync);
    return () => {
      live = false;
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return {
    list,
    add: async (t: string) => {
      await (ready ??= load());
      cache = [...(cache ?? []).filter((x) => x !== t), t];
      notify();
      if (signedIn) await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: [t] }) });
      else writeLocal(cache);
    },
    remove: async (t: string) => {
      await (ready ??= load());
      cache = (cache ?? []).filter((x) => x !== t);
      notify();
      if (signedIn) await fetch(`/api/watchlist?ticker=${encodeURIComponent(t)}`, { method: "DELETE" });
      else writeLocal(cache);
    },
  };
}
