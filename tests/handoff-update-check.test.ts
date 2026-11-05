import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkHandoffCoverage } from '../scripts/check-handoff-update.mjs';

const checkerPath = fileURLToPath(new URL('../scripts/check-handoff-update.mjs', import.meta.url));

const taskRowDiff = [
  'diff --git a/docs/AGENT-HANDOFF.md b/docs/AGENT-HANDOFF.md',
  '@@ -40,0 +41 @@',
  '+| H-04 | Require tracker updates for code PRs | `IN PROGRESS` | branch | pending | implement | none |',
].join('\n');

const inProgressRowDiff = [
  'diff --git a/docs/AGENT-HANDOFF.md b/docs/AGENT-HANDOFF.md',
  '@@ -40,0 +41 @@',
  '+| M-07 | Automation evaluation | `IN PROGRESS` | branch | evidence ready | run final checks | none |',
].join('\n');

const cosmeticHandoffDiff = [
  'diff --git a/docs/AGENT-HANDOFF.md b/docs/AGENT-HANDOFF.md',
  '@@ -1 +1 @@',
  '-**Last updated:** 2026-11-04 12:00 WIB',
  '+**Last updated:** 2026-11-04 12:01 WIB',
].join('\n');

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

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

  it('accepts an IN PROGRESS task-row format without claiming to validate status meaning', () => {
    expect(checkHandoffCoverage(['app/api/health/route.ts', 'docs/AGENT-HANDOFF.md'], inProgressRowDiff)).toMatchObject({ required: true, covered: true });
  });

  it('does not require a handoff row for documentation-only changes', () => {
    expect(checkHandoffCoverage(['README.md', 'docs/AGENT-RESUME-TEMPLATE.md'], '')).toMatchObject({ required: false, covered: true });
  });

  it.each([
    'package.json',
    'Dockerfile',
    '.github/workflows/ci.yml',
    '.github/actions/deploy/action.yml',
    'app.config.ts',
    'instrumentation.ts',
    'next-env.d.ts',
    '.env.example',
    '.npmrc',
    'vercel.json',
  ])(
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

  it('fails closed when valid SHAs cannot be inspected by Git', () => {
    const directory = mkdtempSync(join(tmpdir(), 'handoff-no-git-'));
    try {
      const result = spawnSync(process.execPath, [checkerPath, '0'.repeat(40), '1'.repeat(40)], { cwd: directory, encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('could not inspect the PR diff');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not leak Git stderr when diff inspection fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'handoff-git-error-'));
    try {
      const fakeBin = join(directory, 'bin');
      const sentinel = 'PRIVATE_GIT_STDERR_SENTINEL';
      mkdirSync(fakeBin);
      const fakeGit = join(fakeBin, 'git');
      writeFileSync(fakeGit, `#!/bin/sh\nprintf '%s\\n' '${sentinel}' >&2\nexit 1\n`);
      chmodSync(fakeGit, 0o755);
      const result = spawnSync(process.execPath, [checkerPath, '0'.repeat(40), '1'.repeat(40)], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}` },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('could not inspect the PR diff');
      expect(result.stderr).not.toContain(sentinel);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an implementation-to-documentation rename without a handoff row', () => {
    const repo = mkdtempSync(join(tmpdir(), 'handoff-rename-'));
    try {
      git(repo, 'init', '--quiet');
      git(repo, 'config', 'user.email', 'handoff-test@example.invalid');
      git(repo, 'config', 'user.name', 'Handoff Gate Test');
      mkdirSync(join(repo, 'docs'), { recursive: true });
      mkdirSync(join(repo, 'app', 'api'), { recursive: true });
      writeFileSync(join(repo, 'docs', 'AGENT-HANDOFF.md'), '# Handoff\n');
      writeFileSync(join(repo, 'app', 'api', 'route.ts'), 'export const GET = () => new Response("ok");\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '--quiet', '-m', 'baseline');
      const base = git(repo, 'rev-parse', 'HEAD');

      git(repo, 'mv', 'app/api/route.ts', 'docs/route.md');
      git(repo, 'commit', '--quiet', '-m', 'rename source as documentation');
      const head = git(repo, 'rev-parse', 'HEAD');
      const result = spawnSync(process.execPath, [checkerPath, base, head], { cwd: repo, encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('app/api/route.ts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('requires a handoff row when an implementation file is deleted', () => {
    const repo = mkdtempSync(join(tmpdir(), 'handoff-delete-'));
    try {
      git(repo, 'init', '--quiet');
      git(repo, 'config', 'user.email', 'handoff-test@example.invalid');
      git(repo, 'config', 'user.name', 'Handoff Gate Test');
      mkdirSync(join(repo, 'docs'), { recursive: true });
      mkdirSync(join(repo, 'app', 'api'), { recursive: true });
      writeFileSync(join(repo, 'docs', 'AGENT-HANDOFF.md'), '# Handoff\n');
      writeFileSync(join(repo, 'app', 'api', 'route.ts'), 'export const GET = () => new Response("ok");\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '--quiet', '-m', 'baseline');
      const base = git(repo, 'rev-parse', 'HEAD');

      git(repo, 'rm', 'app/api/route.ts');
      git(repo, 'commit', '--quiet', '-m', 'delete implementation');
      const head = git(repo, 'rev-parse', 'HEAD');
      const result = spawnSync(process.execPath, [checkerPath, base, head], { cwd: repo, encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('app/api/route.ts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('handles a real PR diff even when Git config forces colored output', () => {
    const repo = mkdtempSync(join(tmpdir(), 'handoff-gate-'));
    try {
      git(repo, 'init', '--quiet');
      git(repo, 'config', 'user.email', 'handoff-test@example.invalid');
      git(repo, 'config', 'user.name', 'Handoff Gate Test');
      git(repo, 'config', 'color.ui', 'always');
      mkdirSync(join(repo, 'docs'), { recursive: true });
      mkdirSync(join(repo, 'app', 'api'), { recursive: true });
      writeFileSync(join(repo, 'docs', 'AGENT-HANDOFF.md'), '# Handoff\n\n| ID | Work |\n|---|---|\n| A-01 | Existing task |\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '--quiet', '-m', 'baseline');
      const base = git(repo, 'rev-parse', 'HEAD');

      writeFileSync(join(repo, 'app', 'api', 'route.ts'), 'export const GET = () => new Response("ok");\n');
      git(repo, 'add', 'app');
      git(repo, 'commit', '--quiet', '-m', 'implementation without handoff');
      const codeOnlyHead = git(repo, 'rev-parse', 'HEAD');
      const missingRow = spawnSync(process.execPath, [checkerPath, base, codeOnlyHead], { cwd: repo, encoding: 'utf8' });
      expect(missingRow.status).toBe(1);
      expect(missingRow.stderr).toContain('is not in the PR diff');

      writeFileSync(join(repo, 'docs', 'AGENT-HANDOFF.md'), '\n| H-04 | `IN PROGRESS` | Check colored diff |\n', { flag: 'a' });
      git(repo, 'add', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'implementation with handoff row');
      const head = git(repo, 'rev-parse', 'HEAD');
      const result = spawnSync(process.execPath, [checkerPath, base, head], { cwd: repo, encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Handoff task-row update found');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
