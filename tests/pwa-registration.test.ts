import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const layout = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
const registration = readFileSync(join(root, 'components/service-worker-register.tsx'), 'utf8');
const worker = readFileSync(join(root, 'public/sw.js'), 'utf8');

describe('PWA service-worker registration', () => {
  it('registers the worker from a client component instead of executing it as a page script', () => {
    expect(layout).toContain('<ServiceWorkerRegister />');
    expect(layout).not.toContain('<script src="/sw.js"');
    expect(registration).toContain("navigator.serviceWorker.register('/sw.js', { scope: '/' })");
    expect(registration).toContain("if (!('serviceWorker' in navigator)) return");
  });

  it('keeps the worker limited to same-origin shell requests and never caches API data', () => {
    expect(worker).toContain("if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;");
    expect(worker).toContain("event.request.mode === 'navigate'");
  });
});
