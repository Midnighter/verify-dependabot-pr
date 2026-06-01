import { verifyPolicy } from '../src/policy';
import type { ActionInputs, PullRequest, PullRequestCommit } from '../src/types';
import * as path from 'path';
import * as fs from 'fs';

const fixturesDir = path.join(__dirname, '..', '__fixtures__');

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8')) as T;
}

function defaultInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    githubToken: 'test-token',
    prNumber: 42,
    expectedLogin: 'dependabot[bot]',
    expectedId: 49699333,
    requireVerifiedCommits: true,
    requireSameRepo: true,
    failOnMissingAuthorMetadata: true,
    requireCommitterLoginMatch: false,
    allowedCommitterLogins: ['web-flow'],
    githubApiUrl: 'https://api.github.com',
    ...overrides,
  };
}

describe('verifyPolicy', () => {
  it('happy path — verified PR with verified commits passes', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyPolicy(defaultInputs(), pr, commits);

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

    const result = verifyPolicy(defaultInputs(), modifiedPr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('does not match');
  });

  it('correct login but wrong ID — pr_impersonator fails with "ID"', () => {
    const pr = loadFixture<PullRequest>('pr_impersonator.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyPolicy(defaultInputs(), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('ID');
  });

  it('fork PR with require-same-repo=true fails with "Fork"', () => {
    const pr = loadFixture<PullRequest>('pr_fork.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyPolicy(defaultInputs({ requireSameRepo: true }), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Fork');
  });

  it('null head.repo with require-same-repo=true fails with descriptive message', () => {
    const pr = loadFixture<PullRequest>('pr_deleted_fork.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyPolicy(defaultInputs({ requireSameRepo: true }), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('null');
    expect(result.reason).toContain('Fork');
  });

  it('null head.repo with require-same-repo=false passes', () => {
    const pr = loadFixture<PullRequest>('pr_deleted_fork.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyPolicy(defaultInputs({ requireSameRepo: false }), pr, commits);

    expect(result.verified).toBe(true);
  });

  it('fork PR with require-same-repo=false passes', () => {
    const pr = loadFixture<PullRequest>('pr_fork.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    const result = verifyPolicy(defaultInputs({ requireSameRepo: false }), pr, commits);

    expect(result.verified).toBe(true);
  });

  it('unverified commit fails with "not verified"', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_unverified.json');

    const result = verifyPolicy(defaultInputs({ requireVerifiedCommits: true }), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('not verified');
  });

  it('unverified commit with require-verified-commits=false passes', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_unverified.json');

    const result = verifyPolicy(defaultInputs({ requireVerifiedCommits: false }), pr, commits);

    expect(result.verified).toBe(true);
  });

  it('null author metadata with fail-on-missing=true fails with "null"', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_null_author.json');

    const result = verifyPolicy(defaultInputs({ failOnMissingAuthorMetadata: true }), pr, commits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('null');
  });

  it('null author metadata with fail-on-missing=false passes', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_null_author.json');

    const result = verifyPolicy(
      defaultInputs({ failOnMissingAuthorMetadata: false }),
      pr,
      commits,
    );

    expect(result.verified).toBe(true);
  });

  it('committer is web-flow with require-committer-login-match=true passes (allowed list)', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');

    // commits_verified.json has committer login "web-flow" which is in allowedCommitterLogins
    const result = verifyPolicy(
      defaultInputs({ requireCommitterLoginMatch: true, allowedCommitterLogins: ['web-flow'] }),
      pr,
      commits,
    );

    expect(result.verified).toBe(true);
  });

  it('unknown committer with require-committer-login-match=true fails', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      committer: { login: 'evil-bot', id: 99999 },
    }));

    const result = verifyPolicy(
      defaultInputs({ requireCommitterLoginMatch: true, allowedCommitterLogins: ['web-flow'] }),
      pr,
      modifiedCommits,
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('evil-bot');
  });

  it('committer check skipped when require-committer-login-match=false — unknown committer passes', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c) => ({
      ...c,
      committer: { login: 'some-random-bot', id: 77777 },
    }));

    const result = verifyPolicy(
      defaultInputs({ requireCommitterLoginMatch: false }),
      pr,
      modifiedCommits,
    );

    expect(result.verified).toBe(true);
  });

  it('empty commits array fails with "no commits"', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');

    const result = verifyPolicy(defaultInputs(), pr, []);

    expect(result.verified).toBe(false);
    expect(result.reason.toLowerCase()).toContain('no commits');
    expect(result.checkedCommitCount).toBe(0);
  });

  it('pagination — combined page1 (30) + page2 (5) = 35 commits all pass', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const page1 = loadFixture<PullRequestCommit[]>('commits_paginated/page1.json');
    const page2 = loadFixture<PullRequestCommit[]>('commits_paginated/page2.json');
    const allCommits = [...page1, ...page2];

    expect(allCommits).toHaveLength(35);

    const result = verifyPolicy(defaultInputs(), pr, allCommits);

    expect(result.verified).toBe(true);
    expect(result.checkedCommitCount).toBe(35);
  });

  it('commit author login mismatch fails when one commit has wrong author.login', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    const modifiedCommits: PullRequestCommit[] = commits.map((c, i) =>
      i === 0
        ? { ...c, author: { login: 'someone-else', id: c.author!.id } }
        : c,
    );

    const result = verifyPolicy(defaultInputs(), pr, modifiedCommits);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('does not match');
  });

  it('commits at MAX_COMMITS_PER_PR with require-verified-commits=true fails hard', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
    const baseCommit = loadFixture<PullRequestCommit[]>('commits_verified.json')[0];
    // Create 250 commits (the API maximum)
    const commits: PullRequestCommit[] = Array.from({ length: 250 }, (_, i) => ({
      ...baseCommit,
      sha: `commit-${String(i).padStart(3, '0')}`,
    }));

    const result = verifyPolicy(
      defaultInputs({ requireVerifiedCommits: true }),
      pr,
      commits,
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('API maximum');
    expect(result.reason).toContain('250');
  });

  it('null committer metadata with fail-on-missing=true fails with "null committer"', () => {
    const pr = loadFixture<PullRequest>('pr_dependabot.json');
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

    const result = verifyPolicy(
      defaultInputs({ failOnMissingAuthorMetadata: true }),
      pr,
      commits,
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('null committer');
  });
});
