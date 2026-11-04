import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checkerPath = fileURLToPath(new URL('../scripts/check-handoff-update.mjs', import.meta.url));
const fixtureTaskId = 'F-01';
const initialTaskRow = `| ${fixtureTaskId} | Fixture workflow task | \`TODO\` | — | Not started | Inspect repository fixture | None |`;

function command(cwd: string, executable: string, args: string[]) {
  return spawnSync(executable, args, { cwd, encoding: 'utf8' });
}

function git(cwd: string, ...args: string[]) {
  const result = command(cwd, 'git', args);
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-workflow-rehearsal-'));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(root, 'init', '--bare', '--quiet', remote);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'workflow-fixture@example.invalid');
  git(repo, 'config', 'user.name', 'Workflow Fixture');
  git(repo, 'config', 'color.status', 'false');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'AGENTS.md'), '# Fixture instructions\nRead TODO.md and docs/AGENT-HANDOFF.md before working.\n');
  writeFileSync(join(repo, 'README.md'), '# Isolated workflow fixture\n');
  writeFileSync(join(repo, 'TODO.md'), '- [ ] F-01 — Fixture workflow task\n');
  writeFileSync(
    join(repo, 'docs/AGENT-HANDOFF.md'),
    [
      '# Fixture handoff',
      '',
      '| ID | Work item | Status | Branch / task commit | Verification evidence | Next action | Blocker |',
      '|---|---|---|---|---|---|---|',
      initialTaskRow,
      '',
    ].join('\n'),
  );
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'fixture baseline');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '--quiet', '-u', 'origin', 'main');
  return { root, remote, repo };
}

function writeTaskRow(
  repo: string,
  options: {
    status: 'TODO' | 'IN PROGRESS' | 'BLOCKED' | 'AWAITING APPROVAL' | 'DONE';
    branch?: string;
    commit?: string;
    evidence?: string;
    next?: string;
    blocker?: string;
  },
) {
  const path = join(repo, 'docs/AGENT-HANDOFF.md');
  const handoff = readFileSync(path, 'utf8');
  const row = `| ${fixtureTaskId} | Fixture workflow task | \`${options.status}\` | ${options.branch ?? '—'} / ${options.commit ?? 'pending'} | ${options.evidence ?? 'Pending'} | ${options.next ?? 'None'} | ${options.blocker ?? 'None'} |`;
  const updated = handoff.replace(/^\| F-01 \|.*$/m, row);
  if (updated === handoff) throw new Error('Fixture task row was not found');
  writeFileSync(path, updated);
}

function taskRow(repo: string) {
  return readFileSync(join(repo, 'docs/AGENT-HANDOFF.md'), 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| ${fixtureTaskId} |`)) ?? '';
}

function taskStatus(repo: string) {
  return taskRow(repo).split('|')[3]?.replaceAll('`', '').trim();
}

function writeSmokeFixture(repo: string, value: string) {
  mkdirSync(join(repo, 'app'), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  writeFileSync(join(repo, 'app/health.txt'), `${value}\n`);
  writeFileSync(
    join(repo, 'scripts/smoke.mjs'),
    "import { readFileSync } from 'node:fs';\nif (readFileSync('app/health.txt', 'utf8').trim() !== 'ready') {\n  console.error('smoke check failed');\n  process.exitCode = 1;\n} else {\n  console.log('smoke check passed');\n}\n",
  );
}

describe('isolated Manus workflow rehearsal', () => {
  it('simulates normal completion and fresh-clone recovery with review gating', () => {
    const { root, remote, repo } = makeFixture();
    try {
      expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('Read TODO.md');
      expect(readFileSync(join(repo, 'TODO.md'), 'utf8')).toContain('[ ] F-01');
      expect(git(repo, 'status', '--short', '--branch')).toContain('## main');
      const baseSha = git(repo, 'rev-parse', 'HEAD');
      const branch = 'task/F-01-fixture-workflow';
      git(repo, 'switch', '-c', branch);
      writeTaskRow(repo, {
        status: 'IN PROGRESS',
        branch,
        evidence: 'Repository instructions and TODO located; clean main inspected',
        next: 'Implement fixture route and run smoke plus handoff checks',
      });
      git(repo, 'add', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'start fixture workflow task');

      writeSmokeFixture(repo, 'ready');
      writeFileSync(join(repo, 'app/route.ts'), 'export const GET = () => new Response("ready");\n');
      const smoke = command(repo, process.execPath, [join(repo, 'scripts/smoke.mjs')]);
      expect(smoke.status).toBe(0);
      expect(smoke.stdout).toContain('smoke check passed');
      writeTaskRow(repo, {
        status: 'IN PROGRESS',
        branch,
        evidence: 'Fixture smoke check passed; handoff gate pending',
        next: 'Run the actual handoff gate and commit the fixture implementation',
      });
      git(repo, 'add', 'app', 'scripts', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'implement fixture workflow task');
      const taskCommit = git(repo, 'rev-parse', 'HEAD');

      writeTaskRow(repo, {
        status: 'AWAITING APPROVAL',
        branch,
        commit: taskCommit,
        evidence: 'Fixture smoke and handoff checks passed; review not yet recorded',
        next: 'Wait for required fixture reviewer approval',
      });
      git(repo, 'add', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'record fixture review gate');
      const branchHead = git(repo, 'rev-parse', 'HEAD');
      const gate = command(repo, process.execPath, [checkerPath, baseSha, branchHead]);
      expect(gate.status).toBe(0);
      expect(gate.stdout).toContain('Handoff task-row update found');
      git(repo, 'push', '--quiet', '--set-upstream', 'origin', branch);
      expect(taskStatus(repo)).toBe('AWAITING APPROVAL');
      expect(taskRow(repo)).toContain('review not yet recorded');

      git(repo, 'switch', 'main');
      git(repo, 'merge', '--quiet', '--no-ff', branch, '-m', 'fixture PR merge after approval');
      const mergeCommit = git(repo, 'rev-parse', 'HEAD');
      writeTaskRow(repo, {
        status: 'DONE',
        branch,
        commit: taskCommit,
        evidence: `Fixture checks passed; fixture reviewer approval recorded; local merge ${mergeCommit}`,
        next: 'None',
      });
      git(repo, 'add', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'record fixture task completion after review');
      git(repo, 'push', '--quiet', 'origin', 'main');

      const freshClone = join(root, 'fresh-clone');
      git(root, 'clone', '--quiet', '--branch', 'main', remote, freshClone);
      const recoveredRow = taskRow(freshClone);
      expect(taskStatus(freshClone)).toBe('DONE');
      expect(recoveredRow).toContain(branch);
      expect(recoveredRow).toContain(taskCommit);
      expect(recoveredRow).toContain('fixture reviewer approval recorded');
      expect(recoveredRow).toContain('| None | None |');
      expect(git(freshClone, 'rev-parse', `origin/${branch}`)).toBe(branchHead);
      expect(git(freshClone, 'cat-file', '-e', `${taskCommit}^{commit}`)).toBe('');
      expect(git(freshClone, 'rev-parse', 'HEAD')).not.toBe(baseSha);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects a CI failure, keeps the task open, and passes after a fix', () => {
    const { root, repo } = makeFixture();
    try {
      const baseSha = git(repo, 'rev-parse', 'HEAD');
      const branch = 'task/F-01-ci-recovery';
      git(repo, 'switch', '-c', branch);
      writeTaskRow(repo, {
        status: 'IN PROGRESS',
        branch,
        evidence: 'Fixture task started',
        next: 'Run smoke check and repair if it fails',
      });
      writeSmokeFixture(repo, 'not-ready');
      git(repo, 'add', 'app', 'scripts', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'introduce deterministic fixture CI failure');

      const failingRun = command(repo, process.execPath, [join(repo, 'scripts/smoke.mjs')]);
      expect(failingRun.status).toBe(1);
      expect(failingRun.stderr).toContain('smoke check failed');
      expect(taskStatus(repo)).toBe('IN PROGRESS');
      expect(taskStatus(repo)).not.toBe('DONE');

      writeFileSync(join(repo, 'app/health.txt'), 'ready\n');
      const passingRun = command(repo, process.execPath, [join(repo, 'scripts/smoke.mjs')]);
      expect(passingRun.status).toBe(0);
      expect(passingRun.stdout).toContain('smoke check passed');
      writeTaskRow(repo, {
        status: 'AWAITING APPROVAL',
        branch,
        commit: git(repo, 'rev-parse', 'HEAD'),
        evidence: 'Deterministic smoke failure fixed; rerun passed',
        next: 'Await the fixture review gate before marking DONE',
      });
      git(repo, 'add', 'app/health.txt', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'fix fixture smoke check');
      const headSha = git(repo, 'rev-parse', 'HEAD');
      const gate = command(repo, process.execPath, [checkerPath, baseSha, headSha]);
      expect(gate.status).toBe(0);
      expect(taskStatus(repo)).toBe('AWAITING APPROVAL');
      expect(taskStatus(repo)).not.toBe('DONE');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves a named blocker and does not transition to DONE or merge', () => {
    const { root, repo } = makeFixture();
    try {
      writeTaskRow(repo, {
        status: 'BLOCKED',
        branch: 'task/F-01-blocked',
        evidence: 'The task cannot safely run without its dependency',
        next: 'Resume after an authorized disposable PostgreSQL target is provisioned',
        blocker: 'No disposable PostgreSQL target is available',
      });
      git(repo, 'add', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'record fixture blocker');
      expect(taskStatus(repo)).toBe('BLOCKED');
      expect(taskRow(repo)).toContain('No disposable PostgreSQL target is available');
      expect(taskRow(repo)).toContain('Resume after an authorized disposable PostgreSQL target is provisioned');
      expect(taskStatus(repo)).not.toBe('DONE');
      expect(git(repo, 'branch', '--merged', 'main')).not.toContain('task/F-01-blocked');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects and reconciles a stale main SHA in the resume snapshot', () => {
    const { root, repo } = makeFixture();
    try {
      const initialMainSha = git(repo, 'rev-parse', 'main');
      const handoffPath = join(repo, 'docs/AGENT-HANDOFF.md');
      writeFileSync(handoffPath, `\nLast reconciled main SHA: ${initialMainSha}\n`, { flag: 'a' });
      git(repo, 'add', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'record initial fixture resume snapshot');

      writeFileSync(join(repo, 'README.md'), '# Fixture main advanced\n');
      git(repo, 'add', 'README.md');
      git(repo, 'commit', '--quiet', '-m', 'advance fixture main');
      const observedMainSha = git(repo, 'rev-parse', 'main');
      const staleSnapshot = readFileSync(handoffPath, 'utf8').match(/Last reconciled main SHA: ([a-f0-9]{40})/)?.[1];
      expect(staleSnapshot).toBe(initialMainSha);
      expect(staleSnapshot).not.toBe(observedMainSha);

      writeFileSync(handoffPath, readFileSync(handoffPath, 'utf8').replace(staleSnapshot!, observedMainSha));
      git(repo, 'add', 'docs/AGENT-HANDOFF.md');
      git(repo, 'commit', '--quiet', '-m', 'reconcile fixture resume snapshot');
      expect(readFileSync(handoffPath, 'utf8')).toContain(`Last reconciled main SHA: ${observedMainSha}`);
      expect(git(repo, 'merge-base', '--is-ancestor', observedMainSha, 'main') || '').toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a missing handoff without leaking a source-file sentinel', () => {
    const { root, repo } = makeFixture();
    try {
      const baseSha = git(repo, 'rev-parse', 'HEAD');
      git(repo, 'switch', '-c', 'task/F-01-missing-handoff');
      mkdirSync(join(repo, 'app'), { recursive: true });
      const sentinel = 'PRIVATE_FIXTURE_SENTINEL_DO_NOT_PRINT';
      writeFileSync(join(repo, 'app/private.ts'), `export const fixtureValue = '${sentinel}';\n`);
      git(repo, 'add', 'app/private.ts');
      git(repo, 'commit', '--quiet', '-m', 'change implementation without tracker update');
      const headSha = git(repo, 'rev-parse', 'HEAD');
      const result = command(repo, process.execPath, [checkerPath, baseSha, headSha]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('docs/AGENT-HANDOFF.md is not in the PR diff');
      expect(result.stderr).not.toContain(sentinel);
      expect(taskStatus(repo)).toBe('TODO');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
