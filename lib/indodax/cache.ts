type Entry<T> = { value?: T; expiresAt: number; inFlight?: Promise<T> };
const entries = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>, nowMs = Date.now()): Promise<T> {
  const current = entries.get(key) as Entry<T> | undefined;
  if (current?.value !== undefined && current.expiresAt > nowMs) return current.value;
  if (current?.inFlight) return current.inFlight;
  const inFlight = loader().then((value) => { entries.set(key, { value, expiresAt: Date.now() + ttlMs }); return value; }).catch((error) => { entries.delete(key); throw error; });
  entries.set(key, { expiresAt: 0, inFlight });
  return inFlight;
}

export function resetCache() { entries.clear(); }
