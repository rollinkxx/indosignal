function decimalPlaces(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const text = String(value).trim().toLowerCase();
  if (!text || !Number.isFinite(Number(text))) return 0;
  const [coefficient, exponentText] = text.split('e');
  const exponent = exponentText ? Number(exponentText) : 0;
  const fraction = (coefficient.split('.')[1] ?? '').length;
  return Math.max(0, fraction - exponent);
}

export function formatIdr(value: string | number, tickSize?: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const digits = decimalPlaces(tickSize);
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function formatCompactIdr(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(ms));
}
