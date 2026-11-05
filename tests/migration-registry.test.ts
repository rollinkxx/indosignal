import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const registry = JSON.parse(readFileSync(join(root, 'lib/db/migration-registry.json'), 'utf8')) as {
  initial: string;
  required: string[];
  auditChain: string;
};

function migrationVersion(filename: string) {
  return filename.replace(/\.sql$/, '').replace('_', '-');
}

describe('migration registry', () => {
  it('contains unique required versions with the initial schema first', () => {
    expect(registry.required[0]).toBe(registry.initial);
    expect(new Set(registry.required).size).toBe(registry.required.length);
    expect(registry.required).toContain(registry.auditChain);
  });

  it('matches every numbered SQL migration plus the initial schema', () => {
    const files = readdirSync(join(root, 'scripts/migrations'))
      .filter((filename) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(filename))
      .sort()
      .map(migrationVersion);
    expect(registry.required).toEqual([registry.initial, ...files]);
  });
});
