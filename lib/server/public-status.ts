export function redactOperationalError<T extends object>(status: T): T & { lastError: string | null } {
  const lastError = (status as { lastError?: unknown }).lastError;
  return {
    ...status,
    lastError: typeof lastError === 'string' && lastError ? 'Worker mengalami error; detail teknis tersedia di log operasional.' : null,
  } as T & { lastError: string | null };
}
