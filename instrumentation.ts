export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  const { startForwardTestWorker } = await import('./lib/forward-test/worker');
  startForwardTestWorker();
}
