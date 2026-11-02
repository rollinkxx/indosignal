type Entry<T> = { value?: T; expiresAt: number; inFlight?: Promise<T> };
const entries = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 128;

function prune(nowMs: number, protectedKey?: string): void {
  for (const [key, entry] of entries) {
    if (key !== protectedKey && !entry.inFlight && entry.expiresAt <= nowMs) entries.delete(key);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    if (oldest === protectedKey && entries.size > 1) {
      const value = entries.get(oldest);
      entries.delete(oldest);
      if (value) entries.set(oldest, value);
    } else entries.delete(oldest);
  }
}

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>, nowMs = Date.now()): Promise<T> {
  prune(nowMs, key);
  const current = entries.get(key) as Entry<T> | undefined;
  if (current?.value !== undefined && current.expiresAt > nowMs) {
    entries.delete(key);
    entries.set(key, current);
    return current.value;
  }
  if (current?.inFlight) return current.inFlight;
  const inFlight = loader().then((value) => {
    entries.delete(key);
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    prune(Date.now(), key);
    return value;
  }).catch((error) => { entries.delete(key); throw error; });
  entries.set(key, { expiresAt: 0, inFlight });
  prune(nowMs, key);
  return inFlight;
}

export function resetCache() { entries.clear(); }
export function cacheStats() { return { entries: entries.size, maxEntries: MAX_ENTRIES }; }
