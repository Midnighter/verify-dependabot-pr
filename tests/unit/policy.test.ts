import { verifyPolicy } from '../../src/policy';
import type {
  ActionInputs,
  PullRequest,
  PullRequestCommit,
  RepositoryActivity,
  VerificationResult,
} from '../../src/types';
import * as path from 'path';
import * as fs from 'fs';

const fixturesDir = path.join(__dirname, '..', '..', '__fixtures__');

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8')) as T;
}

function defaultInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    githubToken: 'test-token',
    prNumber: 42,
    headSha: 'def456',
    expectedId: 49699333,
    expectedWebFlowId: 19864447,
    ...overrides,
  };
}

/** pr_dependabot.json with its head moved to the last of these commits. */
function prEndingAt(commits: PullRequestCommit[]): PullRequest {
  const pr = loadFixture<PullRequest>('pr_dependabot.json');
  return {
    ...pr,
    commits: commits.length,
    head: { ...pr.head, sha: commits[commits.length - 1].sha },
  };
}

/** Dependabot's own push, ending at the PR's head commit. */
function dependabotPush(pr: PullRequest, actorId: number): RepositoryActivity {
  return {
    activity_type: 'force_push',
    after: pr.head.sha,
    actor: { login: 'dependabot[bot]', id: actorId },
  };
}

/**
 * verifyPolicy with the newest push already right, so that each case below
 * fails for the rule it is about rather than for the push.
 */
function verifyWithPush(
  inputs: ActionInputs,
  pr: PullRequest,
  commits: PullRequestCommit[],
): VerificationResult {
  return verifyPolicy(inputs, pr, commits, dependabotPush(pr, inputs.expectedId));
}

describe('verifyPolicy', () => {
  it('happy path — verified PR with verified commits passes', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyWithPush(defaultInputs(), pr, commits);

    expect(result.verified).toBe(true);
    expect(result.reason).toBe('');
    expect(result.checkedCommitCount).toBe(2);
  });

  it('wrong login — PR author login mismatch fails with "does not match"', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const modifiedPr: PullRequest = {
      ...pr,
      user: { ...pr.user, login: 'attacker' },
    };
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyWithPush(defaultInputs(), modifiedPr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('does not match');
  });

  it('PR author with Dependabot login but type User fails', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const modifiedPr: PullRequest = { ...pr, user: { ...pr.user, type: 'User' } };
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyWithPush(defaultInputs(), modifiedPr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('type "User"');
  });

  it('correct login but wrong ID — pr_impersonator fails with "ID"', () => {
    const pr = loadFixture<PullRequest>('pr_impersonator.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyWithPush(defaultInputs(), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('ID');
  });

  it('fork PR fails with "Fork"', () => {
    const pr = loadFixture<PullRequest>('pr_fork.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyWithPush(defaultInputs(), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Fork');
  });

  it('null head.repo fails with descriptive message', () => {
    const pr = loadFixture<PullRequest>('pr_deleted_fork.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyWithPush(defaultInputs(), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('null');
    expect(result.reason).toContain('Fork');
  });

  it('unverified commit fails with "not verified"', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_unverified.json');

    const result = verifyWithPush(defaultInputs(), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('not verified');
  });

  it('null author metadata fails with "null"', () => {
    const commits = loadFixture<PullRequestCommit[]>('commits_null_author.json');
    const pr = prEndingAt(commits);

    const result = verifyWithPush(defaultInputs({ headSha: 'abc123' }), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('null');
  });

  it('Dependabot itself as committer passes', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      committer: { login: 'dependabot[bot]', id: 49699333 },
    }));

    const result = verifyWithPush(defaultInputs(), pr, modifiedCommits);

    expect(result.verified).toBe(true);
  });

  it('committer with Dependabot login but another account ID fails', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      committer: { login: 'dependabot[bot]', id: 1000001 },
    }));

    const result = verifyWithPush(defaultInputs(), pr, modifiedCommits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('committer "dependabot[bot]" (ID 1000001)');
  });

  it('unknown committer fails', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      committer: { login: 'evil-bot', id: 99999 },
    }));

    const result = verifyWithPush(defaultInputs(), pr, modifiedCommits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('evil-bot');
  });

  it('a committer claiming web-flow with another account ID fails on GitHub.com', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      committer: { login: 'web-flow', id: 1000001 },
    }));

    const result = verifyWithPush(defaultInputs(), pr, modifiedCommits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain(
      'committer "web-flow" has ID 1000001, not 19864447',
    );
  });

  it("on GHES web-flow keeps the instance's own account ID", () => {
    const commits = loadFixture<PullRequestCommit[]>('commits_verified_ghes.json');
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const ghesPr: PullRequest = {
      ...pr,
      commits: commits.length,
      user: { ...pr.user, id: 1000002 },
      head: { ...pr.head, sha: commits[commits.length - 1].sha },
    };

    const result = verifyWithPush(
      defaultInputs({ expectedId: 1000002, expectedWebFlowId: 1000003 }),
      ghesPr,
      commits,
    );

    expect(result.verified).toBe(true);
    expect(result.reason).toBe('');
  });

  it("on GHES a committer claiming web-flow with another ID fails, whatever Dependabot's ID is", () => {
    const commits = loadFixture<PullRequestCommit[]>('commits_verified_ghes.json');
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const ghesPr: PullRequest = {
      ...pr,
      commits: commits.length,
      user: { ...pr.user, id: 1000002 },
      head: { ...pr.head, sha: commits[commits.length - 1].sha },
    };

    // The instance's web-flow is 1000003; this commit claims the login with
    // GitHub.com's ID, which the old inference accepted because the run was
    // not recognised as GitHub.com.
    const spoofed: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      committer: { login: 'web-flow', id: 19864447 },
    }));

    const result = verifyWithPush(
      defaultInputs({ expectedId: 1000002, expectedWebFlowId: 1000003 }),
      ghesPr,
      spoofed,
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('has ID 19864447, not 1000003');
  });

  it('a commit whose verified field is not exactly true fails', () => {
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      commit: {
        ...c.commit,
        // A malformed response: truthy, but not the boolean the API documents.
        verification: { verified: 'yes' as unknown as boolean, reason: 'valid' },
      },
    }));

    const result = verifyWithPush(
      defaultInputs(),
      prEndingAt(modifiedCommits),
      modifiedCommits,
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('is not verified');
  });

  it('empty commits array fails with "no commits"', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');

    const result = verifyWithPush(defaultInputs(), pr, []);

    expect(result.verified).toBe(false);
    expect(result.reason.toLowerCase()).toContain('no commits');
    expect(result.checkedCommitCount).toBe(0);
  });

  it('pagination — combined page1 (30) + page2 (5) = 35 commits all pass', () => {
    const page1 = loadFixture<PullRequestCommit[]>('commits_paginated/page1.json');
    const page2 = loadFixture<PullRequestCommit[]>('commits_paginated/page2.json');
    const allCommits = [...page1, ...page2];
    const pr = prEndingAt(allCommits);

    expect(allCommits).toHaveLength(35);

    const result = verifyWithPush(
      defaultInputs({ headSha: 'page2-commit-05' }),
      pr,
      allCommits,
    );

    expect(result.verified).toBe(true);
    expect(result.checkedCommitCount).toBe(35);
  });

  it('commit author login mismatch fails when one commit has wrong author.login', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c, i) =>
      i === 0 ? { ...c, author: { login: 'someone-else', id: c.author!.id } } : c,
    );

    const result = verifyWithPush(defaultInputs(), pr, modifiedCommits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('does not match');
  });

  it('commits at MAX_COMMITS_PER_PR fail hard', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const baseCommit = loadFixture<PullRequestCommit[]>('commits_verified.json')[0];
    // Create 250 commits (the API maximum)
    const commits: PullRequestCommit[] = Array.from({ length: 250 }, (_, i) => ({
      ...baseCommit,
      sha: `commit-${String(i).padStart(3, '0')}`,
    }));

    const result = verifyWithPush(defaultInputs(), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('API maximum');
    expect(result.reason).toContain('250');
  });

  it('null committer metadata fails with "null committer"', () => {
    const commits: PullRequestCommit[] = [
      {
        sha: 'abc123',
        commit: {
          message: 'Bump dep',
          verification: { verified: true, reason: 'valid' },
        },
        author: { login: 'dependabot[bot]', id: 49699333 },
        committer: null,
      },
    ];
    const pr = prEndingAt(commits);

    const result = verifyWithPush(defaultInputs({ headSha: 'abc123' }), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('null committer');
  });
});
