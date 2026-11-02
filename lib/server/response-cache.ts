type Entry<T> = { expiresAt: number; value?: T; inFlight?: Promise<T> };
const entries = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 64;

function prune(nowMs: number, keep?: string) {
  for (const [key, entry] of entries) if (key !== keep && !entry.inFlight && entry.expiresAt <= nowMs) entries.delete(key);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    if (oldest === keep && entries.size > 1) {
      const entry = entries.get(oldest);
      entries.delete(oldest);
      if (entry) entries.set(oldest, entry);
    } else entries.delete(oldest);
  }
}

export async function cachedResponse<T>(key: string, ttlMs: number, loader: () => Promise<T>, nowMs = Date.now()): Promise<T> {
  prune(nowMs, key);
  const entry = entries.get(key) as Entry<T> | undefined;
  if (entry?.value !== undefined && entry.expiresAt > nowMs) {
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }
  if (entry?.inFlight) return entry.inFlight;
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

export function resetResponseCacheForTest() { entries.clear(); }
export function responseCacheStats() { return { entries: entries.size, maxEntries: MAX_ENTRIES }; }
