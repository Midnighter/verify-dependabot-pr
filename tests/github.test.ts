import { createClient, fetchAllCommits, fetchPullRequest } from '../src/github';
import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import type { PullRequest, PullRequestCommit } from '../src/types';
import * as path from 'path';
import * as fs from 'fs';

const fixturesDir = path.join(__dirname, '..', '__fixtures__');

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8')) as T;
}

/** Build a minimal mock Octokit with controllable pull endpoints. */
function buildMockOctokit(opts: {
  prData?: PullRequest;
  listCommitsPages?: PullRequestCommit[][];
  listCommitsError?: Error;
  headers?: Record<string, string | number | undefined>;
}) {
  let pageIndex = 0;
  const headers = opts.headers ?? {};

  const mockListCommits = jest.fn().mockImplementation(async () => {
    if (opts.listCommitsError) {
      throw opts.listCommitsError;
    }
    const pages = opts.listCommitsPages ?? [[]];
    const data = pages[pageIndex] ?? [];
    pageIndex++;
    return { data, headers };
  });

  const mockGet = jest.fn().mockResolvedValue({ data: opts.prData, headers });

  return {
    rest: {
      pulls: {
        get: mockGet,
        listCommits: mockListCommits,
      },
    },
    _mocks: { mockGet, mockListCommits },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockOctokit = any;

describe('fetchPullRequest', () => {
  it('returns PR data from octokit.rest.pulls.get', async () => {
    const prFixture = loadFixture<PullRequest>('pr_dependabot.json');
    const octokit = buildMockOctokit({ prData: prFixture }) as MockOctokit;

    const result = await fetchPullRequest(octokit, 'owner', 'repo', 42);

    expect(result).toEqual(prFixture);
    expect(octokit._mocks.mockGet).toHaveBeenCalledTimes(1);
    expect(octokit._mocks.mockGet).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
    });
  });
});

describe('fetchAllCommits', () => {
  it('single page — makes exactly one API call when result has fewer than 100 items', async () => {
    const commits = loadFixture<PullRequestCommit[]>('commits_verified.json');
    // 2 commits < 100, so pagination stops after one call
    const octokit = buildMockOctokit({ listCommitsPages: [commits] }) as MockOctokit;

    const result = await fetchAllCommits(octokit, 'owner', 'repo', 42);

    expect(result).toEqual(commits);
    expect(result).toHaveLength(2);
    expect(octokit._mocks.mockListCommits).toHaveBeenCalledTimes(1);
    expect(octokit._mocks.mockListCommits).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
      per_page: 100,
      page: 1,
    });
  });

  it('pagination — two API calls when first page is full (100 items), second page is partial', async () => {
    const page1Base = loadFixture<PullRequestCommit[]>('commits_paginated/page1.json');
    const page2 = loadFixture<PullRequestCommit[]>('commits_paginated/page2.json');

    // Pad page1 to exactly 100 entries so the pagination loop continues
    const page1: PullRequestCommit[] = [];
    for (let i = 0; i < 100; i++) {
      page1.push({
        ...page1Base[i % page1Base.length],
        sha: `padded-commit-${String(i).padStart(3, '0')}`,
      });
    }

    const octokit = buildMockOctokit({ listCommitsPages: [page1, page2] }) as MockOctokit;

    const result = await fetchAllCommits(octokit, 'owner', 'repo', 42);

    expect(result).toHaveLength(105); // 100 + 5
    expect(octokit._mocks.mockListCommits).toHaveBeenCalledTimes(2);
    expect(octokit._mocks.mockListCommits).toHaveBeenNthCalledWith(1, {
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
      per_page: 100,
      page: 1,
    });
    expect(octokit._mocks.mockListCommits).toHaveBeenNthCalledWith(2, {
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
      per_page: 100,
      page: 2,
    });
  });

  it('API error propagates to the caller', async () => {
    const apiError = new Error('GitHub API rate limit exceeded');
    const octokit = buildMockOctokit({ listCommitsError: apiError }) as MockOctokit;

    await expect(fetchAllCommits(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'GitHub API rate limit exceeded',
    );
  });

  it('stops fetching when commits reach MAX_COMMITS_PER_PR (250)', async () => {
    const page1Base = loadFixture<PullRequestCommit[]>('commits_paginated/page1.json');
    // Create pages of 100 that sum to >=250
    const fullPage: PullRequestCommit[] = [];
    for (let i = 0; i < 100; i++) {
      fullPage.push({
        ...page1Base[i % page1Base.length],
        sha: `commit-${String(i).padStart(3, '0')}`,
      });
    }
    // 3 pages of 100 = 300, but should stop at/after page 3 since 300 >= 250
    const octokit = buildMockOctokit({
      listCommitsPages: [fullPage, fullPage, fullPage, fullPage],
    }) as MockOctokit;

    const result = await fetchAllCommits(octokit, 'owner', 'repo', 42);

    // After page 2 (200 commits), loop continues since 200 < 250.
    // After page 3 (300 commits), 300 >= 250 so it breaks.
    expect(result).toHaveLength(300);
    expect(octokit._mocks.mockListCommits).toHaveBeenCalledTimes(3);
  });
});

describe('createClient', () => {
  it('calls getOctokit with correct parameters', () => {
    const mockGetOctokit = getOctokit as jest.Mock;
    mockGetOctokit.mockReturnValue({});

    createClient('test-token', 'https://api.github.com');

    expect(mockGetOctokit).toHaveBeenCalledWith(
      'test-token',
      { baseUrl: 'https://api.github.com', retry: { retries: 3 } },
      expect.anything(),
    );
  });
});

describe('rate limit awareness', () => {
  const mockWarning = core.warning as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs a warning when x-ratelimit-remaining is below threshold', async () => {
    const prFixture = loadFixture<PullRequest>('pr_dependabot.json');
    const octokit = buildMockOctokit({
      prData: prFixture,
      headers: { 'x-ratelimit-remaining': '50' },
    }) as MockOctokit;

    await fetchPullRequest(octokit, 'owner', 'repo', 42);

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('rate limit is low'),
    );
  });

  it('does not log a warning when x-ratelimit-remaining is above threshold', async () => {
    const prFixture = loadFixture<PullRequest>('pr_dependabot.json');
    const octokit = buildMockOctokit({
      prData: prFixture,
      headers: { 'x-ratelimit-remaining': '4500' },
    }) as MockOctokit;

    await fetchPullRequest(octokit, 'owner', 'repo', 42);

    expect(mockWarning).not.toHaveBeenCalled();
  });

  it('handles numeric x-ratelimit-remaining header value', async () => {
    const prFixture = loadFixture<PullRequest>('pr_dependabot.json');
    const octokit = buildMockOctokit({
      prData: prFixture,
      headers: { 'x-ratelimit-remaining': 42 },
    }) as MockOctokit;

    await fetchPullRequest(octokit, 'owner', 'repo', 42);

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('rate limit is low'),
    );
  });
});

describe('response validation', () => {
  it('throws on invalid PR response missing user', async () => {
    const octokit = buildMockOctokit({
      prData: { number: 42 } as unknown as PullRequest,
    }) as MockOctokit;

    await expect(fetchPullRequest(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'missing required fields',
    );
  });

  it('throws on invalid PR response with user missing login', async () => {
    const octokit = buildMockOctokit({
      prData: { number: 42, user: { id: 123 } } as unknown as PullRequest,
    }) as MockOctokit;

    await expect(fetchPullRequest(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'user missing login or id',
    );
  });

  it('throws on invalid commit response missing sha', async () => {
    const octokit = buildMockOctokit({
      listCommitsPages: [[{ notSha: 'x' } as unknown as PullRequestCommit]],
    }) as MockOctokit;

    await expect(fetchAllCommits(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'missing sha',
    );
  });

  it('throws on invalid commit response missing commit object', async () => {
    const octokit = buildMockOctokit({
      listCommitsPages: [[{ sha: 'abc123' } as unknown as PullRequestCommit]],
    }) as MockOctokit;

    await expect(fetchAllCommits(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'missing commit object',
    );
  });

  it('throws on invalid commit response missing commit.verification', async () => {
    const octokit = buildMockOctokit({
      listCommitsPages: [[{ sha: 'abc123', commit: { message: 'x' } } as unknown as PullRequestCommit]],
    }) as MockOctokit;

    await expect(fetchAllCommits(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'missing commit.verification',
    );
  });
});
