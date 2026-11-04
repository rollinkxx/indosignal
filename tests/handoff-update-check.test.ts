import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkHandoffCoverage } from '../scripts/check-handoff-update.mjs';

const checkerPath = fileURLToPath(new URL('../scripts/check-handoff-update.mjs', import.meta.url));

const taskRowDiff = [
  'diff --git a/docs/AGENT-HANDOFF.md b/docs/AGENT-HANDOFF.md',
  '@@ -40,0 +41 @@',
  '+| H-04 | Require tracker updates for code PRs | `IN PROGRESS` | branch | pending | implement | none |',
].join('\n');

const cosmeticHandoffDiff = [
  'diff --git a/docs/AGENT-HANDOFF.md b/docs/AGENT-HANDOFF.md',
  '@@ -1 +1 @@',
  '-**Last updated:** 2026-11-04 12:00 WIB',
  '+**Last updated:** 2026-11-04 12:01 WIB',
].join('\n');

describe('checkHandoffCoverage', () => {
  it('fails for application changes with no handoff edit', () => {
    expect(checkHandoffCoverage(['app/api/health/route.ts'], '')).toMatchObject({ required: true, covered: false });
  });

  it('fails if the handoff changes only cosmetically without a task row', () => {
    expect(checkHandoffCoverage(['app/api/health/route.ts', 'docs/AGENT-HANDOFF.md'], cosmeticHandoffDiff)).toMatchObject({ required: true, covered: false });
  });

  it('passes when an implementation change adds or updates a task row', () => {
    expect(checkHandoffCoverage(['app/api/health/route.ts', 'docs/AGENT-HANDOFF.md'], taskRowDiff)).toMatchObject({ required: true, covered: true });
  });

  it('does not require a handoff row for documentation-only changes', () => {
    expect(checkHandoffCoverage(['README.md', 'docs/AGENT-RESUME-TEMPLATE.md'], '')).toMatchObject({ required: false, covered: true });
  });

  it.each(['package.json', 'Dockerfile', '.github/workflows/ci.yml'])(
    'requires a task-row update when operational config %s changes',
    (path) => {
      expect(checkHandoffCoverage([path], '')).toMatchObject({ required: true, covered: false });
    },
  );

  it('passes when no files changed', () => {
    expect(checkHandoffCoverage([], '')).toMatchObject({ required: false, covered: true });
  });

  it('rejects malformed base/head SHAs in the CLI', () => {
    const result = spawnSync(process.execPath, [checkerPath, 'not-a-sha', 'also-not-a-sha'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
  });
});
