export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  const { startMultiPairScanner } = await import('./lib/forward-test/multi-pair-worker');
  startMultiPairScanner();
}
