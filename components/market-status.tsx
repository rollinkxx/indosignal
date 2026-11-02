import { formatClock } from '@/lib/format';

type Props = { status: 'live' | 'stale' | 'error' | 'loading'; updatedAtMs?: number; warning?: string };

export function MarketStatus({ status, updatedAtMs, warning }: Props) {
  const label = status === 'live' ? 'LIVE' : status === 'stale' ? 'DATA LAMA' : status === 'loading' ? 'MEMUAT' : 'ERROR';
  return <div className={`status status-${status}`} aria-live="polite">
    <span className="status-dot" aria-hidden="true" />
    <span>{label}</span>
    {updatedAtMs ? <span className="status-time">Pembaruan {formatClock(updatedAtMs)}</span> : null}
    {warning ? <span className="status-warning">{warning}</span> : null}
  </div>;
}
