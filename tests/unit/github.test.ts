import {
  createClient,
  fetchAllCommits,
  fetchNewestPush,
  fetchPullRequest,
} from '../../src/github';
import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import type { PullRequest, PullRequestCommit } from '../../src/types';
import * as path from 'path';
import * as fs from 'fs';

const fixturesDir = path.join(__dirname, '..', '..', '__fixtures__');

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8')) as T;
}

/** Build a minimal mock Octokit with controllable pull endpoints. */
function buildMockOctokit(opts: {
  prData?: PullRequest;
  listCommitsPages?: PullRequestCommit[][];
  listCommitsError?: Error;
  activity?: unknown[];
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

  const mockListActivities = jest
    .fn()
    .mockResolvedValue({ data: opts.activity ?? [], headers });

  return {
    rest: {
      pulls: {
        get: mockGet,
        listCommits: mockListCommits,
      },
      repos: {
        listActivities: mockListActivities,
      },
    },
    _mocks: { mockGet, mockListCommits, mockListActivities },
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

    const octokit = buildMockOctokit({
      listCommitsPages: [page1, page2],
    }) as MockOctokit;

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

describe('fetchNewestPush', () => {
  it('asks for the branch newest first and returns its newest push', async () => {
    const activity = loadFixture<unknown[]>('activity_deleted_branch.json');
    const octokit = buildMockOctokit({ activity }) as MockOctokit;

    const result = await fetchNewestPush(octokit, 'owner', 'repo', 'feature');

    // The newest entry of any kind is the branch deletion, which is not a push.
    expect(result).toEqual({
      activity_type: 'force_push',
      ref: 'refs/heads/dependabot/npm_and_yarn/axios-0.21.4',
      before: 'abc123',
      after: 'def456',
      timestamp: '2026-11-17T10:12:00Z',
      actor: { login: 'dependabot[bot]', id: 49699333 },
    });
    expect(octokit._mocks.mockListActivities).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      ref: 'refs/heads/feature',
      direction: 'desc',
      per_page: 100,
    });
  });

  it('counts a branch creation, which is the only push on a PR never rebased', async () => {
    const octokit = buildMockOctokit({
      activity: [
        {
          activity_type: 'branch_creation',
          after: 'abc123',
          actor: { login: 'dependabot[bot]', id: 49699333 },
        },
      ],
    }) as MockOctokit;

    const result = await fetchNewestPush(octokit, 'owner', 'repo', 'feature');

    expect(result?.after).toBe('abc123');
  });

  it('returns null when the branch has no recorded activity', async () => {
    const octokit = buildMockOctokit({ activity: [] }) as MockOctokit;

    await expect(fetchNewestPush(octokit, 'owner', 'repo', 'feature')).resolves.toBe(
      null,
    );
  });

  it('returns null when no entry is a push', async () => {
    const activity = loadFixture<unknown[]>('activity_no_push.json');
    const octokit = buildMockOctokit({ activity }) as MockOctokit;

    await expect(fetchNewestPush(octokit, 'owner', 'repo', 'feature')).resolves.toBe(
      null,
    );
  });

  it.each([
    ['activity_type', { after: 'def456', actor: null }],
    ['after', { activity_type: 'push', actor: null }],
  ])('throws on an activity entry missing %s', async (_, entry) => {
    const octokit = buildMockOctokit({ activity: [entry] }) as MockOctokit;

    await expect(fetchNewestPush(octokit, 'owner', 'repo', 'feature')).rejects.toThrow(
      'missing activity_type or after',
    );
  });

  it.each([
    ['no id', { login: 'dependabot[bot]' }],
    ['no login', { id: 49699333 }],
    ['nothing at all', undefined],
  ])('throws on an activity entry whose actor has %s', async (_, actor) => {
    const octokit = buildMockOctokit({
      activity: [{ activity_type: 'push', after: 'def456', actor }],
    }) as MockOctokit;

    await expect(fetchNewestPush(octokit, 'owner', 'repo', 'feature')).rejects.toThrow(
      'actor is incomplete',
    );
  });

  it('accepts an entry whose actor GitHub could not name', async () => {
    const octokit = buildMockOctokit({
      activity: [{ activity_type: 'push', after: 'def456', actor: null }],
    }) as MockOctokit;

    const result = await fetchNewestPush(octokit, 'owner', 'repo', 'feature');

    // The policy rejects it; reading the response is not where that happens.
    expect(result?.actor).toBe(null);
  });
});

describe('createClient', () => {
  it('calls getOctokit with correct parameters', () => {
    const mockGetOctokit = getOctokit as jest.Mock;
    mockGetOctokit.mockReturnValue({});

    createClient('test-token');

    // No baseUrl, so getOctokit uses the runner's GITHUB_API_URL.
    expect(mockGetOctokit).toHaveBeenCalledWith(
      'test-token',
      { retry: { retries: 3 } },
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
  it.each([
    ['user', { number: 42, commits: 1 }],
    ['commits', { number: 42, user: { login: 'dependabot[bot]', id: 49699333 } }],
  ])('throws on invalid PR response missing %s', async (_, prData) => {
    const octokit = buildMockOctokit({
      prData: prData as unknown as PullRequest,
    }) as MockOctokit;

    await expect(fetchPullRequest(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'missing required fields',
    );
  });

  it('throws on invalid PR response with user missing login', async () => {
    const octokit = buildMockOctokit({
      prData: { number: 42, commits: 1, user: { id: 123 } } as unknown as PullRequest,
    }) as MockOctokit;

    await expect(fetchPullRequest(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'user missing login or id',
    );
  });

  it.each([
    ['head', { repo: { id: 1 } }],
    ['head.sha', { head: { repo: { id: 1 } }, base: { repo: { id: 1 } } }],
    [
      'head.repo.id',
      {
        head: { sha: 'def456', repo: { full_name: 'owner/repo' } },
        base: { repo: { id: 1 } },
      },
    ],
    [
      'base.repo.id',
      {
        head: { sha: 'def456', repo: null },
        base: { repo: { full_name: 'owner/repo' } },
      },
    ],
  ])('throws on invalid PR response missing %s', async (_, fields) => {
    const octokit = buildMockOctokit({
      prData: {
        number: 42,
        commits: 1,
        user: { login: 'dependabot[bot]', id: 49699333 },
        ...fields,
      } as unknown as PullRequest,
    }) as MockOctokit;

    await expect(fetchPullRequest(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'head or base is incomplete',
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
      listCommitsPages: [
        [{ sha: 'abc123', commit: { message: 'x' } } as unknown as PullRequestCommit],
      ],
    }) as MockOctokit;

    await expect(fetchAllCommits(octokit, 'owner', 'repo', 42)).rejects.toThrow(
      'missing commit.verification',
    );
  });
});
