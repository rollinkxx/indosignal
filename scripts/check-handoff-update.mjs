import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const HANDOFF_PATH = 'docs/AGENT-HANDOFF.md';

const IMPLEMENTATION_ROOTS = [
  'app/',
  'components/',
  'lib/',
  'scripts/',
  'tests/',
  'public/',
  'db/',
  'migrations/',
  '.github/actions/',
  '.github/workflows/',
];

const IMPLEMENTATION_ROOT_FILES = [
  /^\.dockerignore$/,
  /^\.env(?:\..*)?$/,
  /^\.gitignore$/,
  /^\.npmrc$/,
  /^Dockerfile(?:\..*)?$/,
  /^docker-compose(?:\.[^.]+)?\.ya?ml$/,
  /^eslint\.config\.[^/]+$/,
  /^next\.config\.[^/]+$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^postcss\.config\.[^/]+$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
  /^vitest\.config\.[^/]+$/,
  /^[^.][^/]*\.(?:[cm]?[jt]sx?|d\.ts)$/,
  /^[^.][^/]*\.(?:json|toml|ya?ml)$/,
];

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isImplementationPath(filePath) {
  const normalized = normalizePath(filePath);
  return IMPLEMENTATION_ROOTS.some((root) => normalized.startsWith(root))
    || IMPLEMENTATION_ROOT_FILES.some((pattern) => pattern.test(normalized));
}

function addsOrEditsTaskRow(diff) {
  return diff.split(/\r?\n/).some((line) => /^\+\|\s*[A-Z][A-Z0-9]*-\d+\s*\|/.test(line));
}

export function checkHandoffCoverage(changedFiles, handoffDiff = '') {
  const implementationFiles = changedFiles.map(normalizePath).filter(isImplementationPath);
  const required = implementationFiles.length > 0;
  const handoffChanged = changedFiles.map(normalizePath).includes(HANDOFF_PATH);
  const taskRowChanged = handoffChanged && addsOrEditsTaskRow(handoffDiff);
  const covered = !required || taskRowChanged;

  let reason;
  if (!required) {
    reason = 'No implementation/configuration files changed; a handoff row is not required.';
  } else if (!handoffChanged) {
    reason = `Implementation/configuration changed (${implementationFiles.join(', ')}), but ${HANDOFF_PATH} is not in the PR diff.`;
  } else if (!taskRowChanged) {
    reason = `${HANDOFF_PATH} changed, but no task-tracker row was added or edited; update a row using the +| TASK-ID | table format.`;
  } else {
    reason = `Handoff task-row update found for implementation/configuration changes (${implementationFiles.join(', ')}).`;
  }

  return { required, covered, reason, implementationFiles, taskRowChanged };
}

function runCli() {
  const [baseSha, headSha, ...extra] = process.argv.slice(2);
  const shaPattern = /^[a-f0-9]{40}$/i;
  if (extra.length || !shaPattern.test(baseSha ?? '') || !shaPattern.test(headSha ?? '')) {
    console.error('Usage: node scripts/check-handoff-update.mjs <40-char-base-sha> <40-char-head-sha>');
    process.exitCode = 2;
    return;
  }

  try {
    const range = `${baseSha}...${headSha}`;
    const changedOutput = execFileSync('git', ['diff', '--name-only', '--no-renames', range], { encoding: 'utf8' });
    const changedFiles = changedOutput.split(/\r?\n/).filter(Boolean);
    const handoffDiff = execFileSync('git', ['diff', '--no-color', '--unified=0', range, '--', HANDOFF_PATH], { encoding: 'utf8' });
    const result = checkHandoffCoverage(changedFiles, handoffDiff);

    if (!result.covered) {
      console.error(`Handoff coverage check failed: ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Handoff coverage check passed: ${result.reason}`);
  } catch {
    console.error('Handoff coverage check could not inspect the PR diff. Ensure both base and head commits are available in the checkout.');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli();
}
