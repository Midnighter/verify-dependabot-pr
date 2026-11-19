/**
 * Compares the merge script's copy of the commit rules with `verifyPolicy`.
 *
 * `scripts/merge_dependabot_prs.sh` re-implements the policy in jq rather than
 * calling the action, deliberately: the action verifies this repository's own
 * Dependabot pull requests only once it is built and released, so gating them
 * on it would let a bad change to `src/policy.ts` block the pull requests that
 * fix it.
 *
 * The cost of that duplication is drift. The script once claimed "the same
 * rules as the action" while missing three of them, including a repository
 * comparison by name that the action had already replaced with one by ID. This
 * test runs the same fixtures through both and fails when their verdicts
 * disagree, so the next rule added to one has to be added to the other.
 *
 * It reads `scripts/dependabot_commits.jq`, the file the script itself runs, so
 * the comparison cannot drift from what the script does.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEPENDABOT_ID_ON_GITHUB_COM,
  WEB_FLOW_ID_ON_GITHUB_COM,
  verifyPolicy,
} from '../../src/policy';
import {
  MAX_COMMITS_PER_PR,
  type ActionInputs,
  type PullRequest,
  type PullRequestCommit,
} from '../../src/types';

const repoRoot = path.join(__dirname, '..', '..');
const fixturesDir = path.join(repoRoot, '__fixtures__');
const commitFilter = path.join(repoRoot, 'scripts', 'dependabot_commits.jq');

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8')) as T;
}

/**
 * The script's verdict: jq exits 0 when the filter returns true, 1 when it
 * returns false, and anything else means the filter itself is broken.
 */
function scriptAccepts(
  commits: PullRequestCommit[],
  head: string,
  total: number,
): boolean {
  try {
    execFileSync(
      'jq',
      [
        '--exit-status',
        '--arg',
        'head',
        head,
        '--argjson',
        'total',
        String(total),
        '--argjson',
        'id',
        String(DEPENDABOT_ID_ON_GITHUB_COM),
        '--argjson',
        'web_flow_id',
        String(WEB_FLOW_ID_ON_GITHUB_COM),
        '--argjson',
        'max',
        String(MAX_COMMITS_PER_PR),
        '--from-file',
        commitFilter,
      ],
      // The script slurps the API's pages, so the filter sees an array of
      // pages and starts with `add`.
      { input: JSON.stringify([commits]), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) {
      return false;
    }
    throw new Error(
      `jq failed with status ${status}: ${String((error as { stderr?: Buffer }).stderr)}`,
      { cause: error },
    );
  }
}

/** The action's verdict for the same commits, with the commit rules reached. */
function policyAccepts(
  commits: PullRequestCommit[],
  head: string,
  total: number,
): boolean {
  const pr = loadFixture<PullRequest>('pr_dependabot.json');
  const inputs: ActionInputs = {
    githubToken: 'test-token',
    prNumber: 42,
    headSha: head,
    expectedId: DEPENDABOT_ID_ON_GITHUB_COM,
    expectedWebFlowId: WEB_FLOW_ID_ON_GITHUB_COM,
  };
  return verifyPolicy(
    inputs,
    { ...pr, commits: total, head: { ...pr.head, sha: head } },
    commits,
  ).verified;
}

/** A commit the policy and the filter both accept, as a base to vary. */
function genuineCommit(sha: string): PullRequestCommit {
  return {
    sha,
    commit: {
      message: 'deps: bump something from 1.0.0 to 1.0.1',
      verification: { verified: true, reason: 'valid' },
    },
    author: { login: 'dependabot[bot]', id: DEPENDABOT_ID_ON_GITHUB_COM },
    committer: { login: 'web-flow', id: WEB_FLOW_ID_ON_GITHUB_COM },
  };
}

/**
 * Each case is a commit list the two implementations must agree on. `accepts`
 * is asserted as well as the agreement, so a case that silently stops
 * exercising its rule shows up.
 */
const cases: { name: string; commits: PullRequestCommit[]; accepts: boolean }[] = [
  {
    name: 'a genuine single-commit PR',
    commits: [genuineCommit('abc123')],
    accepts: true,
  },
  {
    name: 'a genuine two-commit PR',
    commits: loadFixture<PullRequestCommit[]>('commits_verified.json'),
    accepts: true,
  },
  {
    name: 'a commit signed by a person naming Dependabot as author',
    commits: loadFixture<PullRequestCommit[]>('commits_spoofed_author.json'),
    accepts: false,
  },
  {
    name: "an author with Dependabot's login but another account ID",
    commits: loadFixture<PullRequestCommit[]>('commits_author_id_mismatch.json'),
    accepts: false,
  },
  {
    name: 'an unsigned commit',
    commits: loadFixture<PullRequestCommit[]>('commits_unverified.json'),
    accepts: false,
  },
  {
    name: 'a commit with no author account',
    commits: loadFixture<PullRequestCommit[]>('commits_null_author.json'),
    accepts: false,
  },
  {
    name: 'a commit by a person, not Dependabot',
    commits: loadFixture<PullRequestCommit[]>('commits_human_author.json'),
    accepts: false,
  },
  {
    name: 'a committer claiming web-flow with another account ID',
    commits: [
      {
        ...genuineCommit('abc123'),
        committer: { login: 'web-flow', id: 1000001 },
      },
    ],
    accepts: false,
  },
  {
    name: 'Dependabot as its own committer',
    commits: [
      {
        ...genuineCommit('abc123'),
        committer: { login: 'dependabot[bot]', id: DEPENDABOT_ID_ON_GITHUB_COM },
      },
    ],
    accepts: true,
  },
  {
    name: 'a verified field that is truthy but not true',
    commits: [
      {
        ...genuineCommit('abc123'),
        commit: {
          message: 'deps: bump something',
          verification: { verified: 'yes' as unknown as boolean, reason: 'valid' },
        },
      },
    ],
    accepts: false,
  },
];

describe('the merge script and verifyPolicy agree', () => {
  it.each(cases)('on $name', ({ commits, accepts }) => {
    const head = commits[commits.length - 1].sha;
    const total = commits.length;

    expect({
      script: scriptAccepts(commits, head, total),
      policy: policyAccepts(commits, head, total),
    }).toEqual({ script: accepts, policy: accepts });
  });

  it('on a commit list that does not end at the head commit', () => {
    const commits = [genuineCommit('abc123'), genuineCommit('def456')];

    expect(scriptAccepts(commits, 'abc123', 2)).toBe(false);
    expect(policyAccepts(commits, 'abc123', 2)).toBe(false);
  });

  it("on a commit list shorter than the PR's own count", () => {
    const commits = [genuineCommit('abc123')];

    expect(scriptAccepts(commits, 'abc123', 3)).toBe(false);
    expect(policyAccepts(commits, 'abc123', 3)).toBe(false);
  });

  it('on an empty commit list', () => {
    expect(scriptAccepts([], 'abc123', 0)).toBe(false);
    expect(policyAccepts([], 'abc123', 0)).toBe(false);
  });

  it('on a PR at the API commit cap', () => {
    const commits = Array.from({ length: MAX_COMMITS_PER_PR }, (_, i) =>
      genuineCommit(`sha${i}`),
    );
    const head = commits[commits.length - 1].sha;

    expect(scriptAccepts(commits, head, MAX_COMMITS_PER_PR)).toBe(false);
    expect(policyAccepts(commits, head, MAX_COMMITS_PER_PR)).toBe(false);
  });
});
