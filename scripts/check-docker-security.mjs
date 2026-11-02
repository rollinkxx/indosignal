import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const ignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.packageManager, 'pnpm@10.34.5', 'packageManager must be exact-pinned');
assert.match(dockerfile, /corepack prepare pnpm@10\.34\.5 --activate/);
assert.match(dockerfile, /adduser -S -u 1001 -G nextjs nextjs/);
assert.match(dockerfile, /USER nextjs\n/);
assert.match(dockerfile, /pnpm install --prod --frozen-lockfile/);
assert.match(dockerfile, /unset MIGRATION_DATABASE_URL MIGRATION_DATABASE_SSL/);
assert.doesNotMatch(dockerfile, /COPY\s+\.env(?:\s|$)|COPY\s+\.\.env(?:\s|$)/);
for (const line of ['.env', '.env.*', '*.pem', '*.key', '*.p12']) assert.ok(ignore.split(/\r?\n/).includes(line), `.dockerignore must exclude ${line}`);
console.log('Docker security static checks PASS: pinned toolchain, non-root final stage, prod-only install, secret exclusions.');
