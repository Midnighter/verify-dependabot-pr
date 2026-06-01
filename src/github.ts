import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { retry } from '@octokit/plugin-retry';
import { MAX_COMMITS_PER_PR, type PullRequest, type PullRequestCommit } from './types';

type OctokitClient = ReturnType<typeof getOctokit>;

const RATE_LIMIT_WARNING_THRESHOLD = 100;

/**
 * Validate that the API response contains the required PullRequest fields.
 */
function assertPullRequest(data: unknown): asserts data is PullRequest {
  const d = data as Record<string, unknown>;
  if (
    typeof d !== 'object' ||
    d === null ||
    typeof d.number !== 'number' ||
    typeof d.user !== 'object' ||
    d.user === null
  ) {
    throw new Error('Unexpected PR response shape: missing required fields (number, user).');
  }
  const user = d.user as Record<string, unknown>;
  if (typeof user.login !== 'string' || typeof user.id !== 'number') {
    throw new Error('Unexpected PR response shape: user missing login or id.');
  }
}

/**
 * Validate that an API response item contains the required PullRequestCommit fields.
 */
function assertPullRequestCommit(data: unknown, index: number): asserts data is PullRequestCommit {
  const d = data as Record<string, unknown>;
  if (typeof d !== 'object' || d === null || typeof d.sha !== 'string') {
    throw new Error(`Unexpected commit response shape at index ${index}: missing sha.`);
  }
  const commit = d.commit as Record<string, unknown> | undefined;
  if (typeof commit !== 'object' || commit === null) {
    throw new Error(`Unexpected commit response shape at index ${index}: missing commit object.`);
  }
  const verification = commit.verification as Record<string, unknown> | undefined;
  if (typeof verification !== 'object' || verification === null) {
    throw new Error(`Unexpected commit response shape at index ${index}: missing commit.verification.`);
  }
}

/**
 * Log a warning if the rate limit remaining is below the threshold.
 */
function checkRateLimit(headers: Record<string, string | number | undefined>): void {
  const remaining = headers['x-ratelimit-remaining'];
  if (remaining !== undefined) {
    const value = typeof remaining === 'string' ? parseInt(remaining, 10) : remaining;
    if (typeof value === 'number' && !isNaN(value) && value < RATE_LIMIT_WARNING_THRESHOLD) {
      core.warning(
        `GitHub API rate limit is low: ${value} requests remaining. ` +
        'Consider using a token with higher rate limits.',
      );
    }
  }
}

export function createClient(
  token: string,
  baseUrl: string,
): OctokitClient {
  return getOctokit(token, { baseUrl, retry: { retries: 3 } }, retry);
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
