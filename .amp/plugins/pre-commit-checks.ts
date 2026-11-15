import type { PluginAPI } from '@ampcode/plugin';
import path from 'node:path';

export const description =
  'Runs the CI checks, plus the zizmor audit and the actions lockfile check when a workflow changed, before every agent `git commit` and blocks the commit when any check fails.';

const repoRoot = path.resolve(import.meta.dir, '..', '..');

// The steps of the CI `ci` job, with the local Node version only.
const checks = [
  'npm audit --audit-level=high',
  'npm run lint',
  'npm run lint:shell',
  'npm run lint:workflows',
  'npm run format:check',
  'npm run typecheck',
  'npm run test',
  'npm run build',
];

// `git commit`, also with global options such as `git -C dir commit`, but not
// `git commit-tree` or a `commit` argument after a command separator.
const gitCommit = /\bgit\b[^;&|\n]*?\scommit(?![\w-])/;

const tail = (text: string, lines: number) =>
  text.trimEnd().split('\n').slice(-lines).join('\n');

export default function (amp: PluginAPI) {
  amp.on('tool.call', async (event, ctx) => {
    const shell = amp.helpers.shellCommandFromToolCall(event);
    if (!shell || !gitCommit.test(shell.command)) {
      return { action: 'allow' };
    }
    // Leave commits in other checkouts alone.
    if (
      shell.dir &&
      path.relative(repoRoot, path.resolve(repoRoot, shell.dir)).startsWith('..')
    ) {
      return { action: 'allow' };
    }

    // Run in a login shell so uvx and gh from `~/.local/bin` are on PATH. When a file
    // under `.github/workflows/` differs from HEAD (staged, unstaged, or untracked),
    // also run the Workflow Security job's zizmor audit, with the version it pins,
    // and the CI `lockfile` job. Not only staged files: the checks run before git
    // does, so files the same command stages are not staged yet.
    const script = `
      cd "$1" || exit 1
      shift
      if [ -n "$(git status --porcelain -- .github/workflows)" ]; then
        zizmor_version="$(sed -n 's/^ *version: *//p' .github/workflows/zizmor.yml)"
        set -- "$@" "uvx zizmor@$zizmor_version .github/workflows" "gh actions-lock --verify"
      fi
      failed=0
      for check in "$@"; do
        if ! output="$($check 2>&1)"; then
          printf 'FAILED: %s\n%s\n\n' "$check" "$output"
          failed=1
        fi
      done
      exit $failed
    `;
    ctx.logger.log(`running pre-commit checks for: ${shell.command}`);
    const result =
      await ctx.$`bash -lc ${script} pre-commit-checks ${repoRoot} ${checks}`;
    if (result.exitCode === 0) {
      return { action: 'allow' };
    }
    return {
      action: 'reject-and-continue',
      message: [
        'Commit blocked by .amp/plugins/pre-commit-checks.ts. Fix these failing checks, then commit again.',
        '',
        tail(`${result.stdout}\n${result.stderr}`, 150),
      ].join('\n'),
    };
  });
}
