import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['app', 'components', 'lib', 'scripts'];
const forbidden = [/Math\.random\s*\(/i, /faker/i, /mock(?:ed|s)?/i, /fixture/i, /sample\s+data/i];
const allowedFiles = new Set(['lib/indodax/client.ts']);
const violations = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !path.endsWith('check-no-market-mocks.mjs')) {
      const text = await readFile(path, 'utf8');
      for (const pattern of forbidden) if (pattern.test(text) && !allowedFiles.has(path)) violations.push(`${path}: ${pattern}`);
    }
  }
}
for (const root of roots) await walk(root);
if (violations.length) { console.error('Forbidden market-data patterns found:\n' + violations.join('\n')); process.exit(1); }
console.log('market mock guard: clean');
