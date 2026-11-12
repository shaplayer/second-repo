// Small in-memory cache so repeated page loads don't re-hit Databento or the SEC.
type Entry = { at: number; value: Promise<unknown> };

const g = globalThis as unknown as { __bsCache?: Map<string, Entry> };
const store = (g.__bsCache ??= new Map<string, Entry>());

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { at: Date.now(), value });
  return value;
}
