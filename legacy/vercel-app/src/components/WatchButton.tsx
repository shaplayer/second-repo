"use client";

import { useWatchlist } from "./useWatchlist";

export default function WatchButton({ ticker }: { ticker: string }) {
  const { list, add, remove } = useWatchlist();
  const on = list?.includes(ticker) ?? false;
  return (
    <button className={on ? "btn" : "btn primary"} onClick={() => (on ? remove(ticker) : add(ticker))} disabled={!list}>
      {on ? "✓ On your watchlist" : "+ Add to watchlist"}
    </button>
  );
}
