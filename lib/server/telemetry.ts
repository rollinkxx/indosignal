import { getProviderRequestStats } from '../indodax/client';

export function runtimeTelemetry() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const upstream = Object.entries(getProviderRequestStats()).map(([endpoint, stats]) => ({
    endpoint, count: stats.count, errors: stats.errors,
    averageLatencyMs: Number(stats.averageMs.toFixed(2)), maximumLatencyMs: stats.maxMs,
  }));
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
    cumulativeCpuMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
    upstream,
  };
}
