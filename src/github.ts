import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { retry } from '@octokit/plugin-retry';
import {
  MAX_COMMITS_PER_PR,
  type PullRequest,
  type PullRequestCommit,
  type RepositoryActivity,
} from './types';

type OctokitClient = ReturnType<typeof getOctokit>;

const RATE_LIMIT_WARNING_THRESHOLD = 100;

/**
 * The activity types that record someone pushing a branch. A branch creation
 * counts: a Dependabot PR that has never been rebased has no later push, and
 * its head commit arrived with the branch.
 *
 * The other types GitHub records, a merge into the branch and a deletion, are
 * deliberately not pushes. A merge leaves the branch at a commit no push ended
 * at, which the policy rejects, and a deletion is what a merged pull request
 * leaves behind, so counting it would hide the push that set the head.
 */
const PUSH_ACTIVITY_TYPES = ['push', 'force_push', 'branch_creation'];

/**
 * Validate that the API response contains the required PullRequest fields.
 */
function assertPullRequest(data: unknown): asserts data is PullRequest {
  const d = data as Record<string, unknown>;
  if (
    typeof d !== 'object' ||
    d === null ||
    typeof d.number !== 'number' ||
    typeof d.commits !== 'number' ||
    typeof d.user !== 'object' ||
    d.user === null
  ) {
    throw new Error(
      'Unexpected PR response shape: missing required fields (number, commits, user).',
    );
  }
  const user = d.user as Record<string, unknown>;
  if (typeof user.login !== 'string' || typeof user.id !== 'number') {
    throw new Error('Unexpected PR response shape: user missing login or id.');
  }
  // The policy compares these, so a missing value must not compare as equal.
  const head = d.head as Record<string, unknown> | null | undefined;
  const base = d.base as Record<string, unknown> | null | undefined;
  if (
    typeof head !== 'object' ||
    head === null ||
    typeof head.sha !== 'string' ||
    typeof head.ref !== 'string' ||
    !(head.repo === null || hasNumericId(head.repo)) ||
    typeof base !== 'object' ||
    base === null ||
    !hasNumericId(base.repo)
  ) {
    throw new Error('Unexpected PR response shape: head or base is incomplete.');
  }
}

function hasNumericId(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === 'number'
  );
}

function isAccountOrNull(value: unknown): boolean {
  return (
    value === null ||
    (hasNumericId(value) &&
      typeof (value as Record<string, unknown>).login === 'string')
  );
}

/**
 * Validate that an API response item contains the required PullRequestCommit fields.
 */
function assertPullRequestCommit(
  data: unknown,
  index: number,
): asserts data is PullRequestCommit {
  const d = data as Record<string, unknown>;
  if (typeof d !== 'object' || d === null || typeof d.sha !== 'string') {
    throw new Error(`Unexpected commit response shape at index ${index}: missing sha.`);
  }
  const commit = d.commit as Record<string, unknown> | undefined;
  if (typeof commit !== 'object' || commit === null) {
    throw new Error(
      `Unexpected commit response shape at index ${index}: missing commit object.`,
    );
  }
  const verification = commit.verification as Record<string, unknown> | undefined;
  if (typeof verification !== 'object' || verification === null) {
    throw new Error(
      `Unexpected commit response shape at index ${index}: missing commit.verification.`,
    );
  }
}

/**
 * Validate that an activity response item contains the required fields. An
 * entry whose actor GitHub cannot name keeps its null, which the policy rejects.
 */
function assertRepositoryActivity(
  data: unknown,
  index: number,
): asserts data is RepositoryActivity {
  const d = data as Record<string, unknown>;
  if (
    typeof d !== 'object' ||
    d === null ||
    typeof d.activity_type !== 'string' ||
    typeof d.after !== 'string'
  ) {
    throw new Error(
      `Unexpected activity response shape at index ${index}: missing activity_type or after.`,
    );
  }
  if (!isAccountOrNull(d.actor)) {
    throw new Error(
      `Unexpected activity response shape at index ${index}: actor is incomplete.`,
    );
  }
}

/**
 * Log a warning if the rate limit remaining is below the threshold.
 */
function checkRateLimit(headers: Record<string, string | number | undefined>): void {
  const remaining = headers['x-ratelimit-remaining'];
  if (remaining !== undefined) {
    const value = typeof remaining === 'string' ? parseInt(remaining, 10) : remaining;
    if (
      typeof value === 'number' &&
      !isNaN(value) &&
      value < RATE_LIMIT_WARNING_THRESHOLD
    ) {
      core.warning(
        `GitHub API rate limit is low: ${value} requests remaining. ` +
          'Consider using a token with higher rate limits.',
      );
    }
  }
}

/**
 * The client talks to the runner's own GitHub instance: without a baseUrl,
 * getOctokit uses GITHUB_API_URL, which workflows cannot change.
 */
export function createClient(token: string): OctokitClient {
  return getOctokit(token, { retry: { retries: 3 } }, retry);
}

export async function fetchPullRequest(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequest> {
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  checkRateLimit(response.headers as Record<string, string | number | undefined>);
  assertPullRequest(response.data);
  return response.data;
}

export async function fetchAllCommits(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestCommit[]> {
  const commits: PullRequestCommit[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const response = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page,
    });
    checkRateLimit(response.headers as Record<string, string | number | undefined>);

    const data = response.data;
    for (let i = 0; i < data.length; i++) {
      assertPullRequestCommit(data[i], commits.length + i);
    }
    commits.push(...(data as unknown as PullRequestCommit[]));

    if (data.length < perPage || commits.length >= MAX_COMMITS_PER_PR) {
      break;
    }
    page++;
  }

  return commits;
}

/**
 * The newest push to a branch, or null when the API records none.
 *
 * A commit does not say who put it on a branch, and GitHub signs a squash merge
 * as Dependabot whatever the pull request held, so the commits alone cannot tell
 * the two apart. The repository's activity can: it names the actor of every
 * push.
 */
export async function fetchNewestPush(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<RepositoryActivity | null> {
  const response = await octokit.rest.repos.listActivities({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    direction: 'desc',
    per_page: 100,
  });
  checkRateLimit(response.headers as Record<string, string | number | undefined>);

  const data = response.data;
  for (let i = 0; i < data.length; i++) {
    assertRepositoryActivity(data[i], i);
  }

  // Newest first, so the first push in the list is the newest one.
  return (
    (data as unknown as RepositoryActivity[]).find((entry) =>
      PUSH_ACTIVITY_TYPES.includes(entry.activity_type),
    ) ?? null
  );
}
