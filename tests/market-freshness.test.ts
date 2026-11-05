import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'components/market-overview.tsx'), 'utf8');

describe('market freshness UI', () => {
  it('refreshes the internal market endpoint and stops work while hidden', () => {
    expect(source).toContain("fetch('/api/market', { cache: 'no-store'");
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain('window.setInterval');
    expect(source).toContain('document.addEventListener');
    expect(source).toContain('window.clearInterval');
  });

  it('marks the existing snapshot stale instead of inventing replacement prices on refresh failure', () => {
    expect(source).toContain("status: market.status === 'live' ? 'stale' : market.status");
    expect(source).toContain('Pembaruan gagal; menampilkan data lama');
    expect(source).not.toContain('Math.random');
  });
});
