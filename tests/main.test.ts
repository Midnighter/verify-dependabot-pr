import * as core from '@actions/core';
import * as github from '@actions/github';
import * as path from 'path';
import * as fs from 'fs';
import { run } from '../src/main';

const fixturesDir = path.join(__dirname, '..', '__fixtures__');

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8')) as T;
}

const mockGetInput = core.getInput as jest.Mock;
const mockGetBooleanInput = core.getBooleanInput as jest.Mock;
const mockSetOutput = core.setOutput as jest.Mock;
const mockSetFailed = core.setFailed as jest.Mock;
const mockGetOctokit = github.getOctokit as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('main entry point', () => {
  it('missing pr-number calls setFailed with "pr-number is required"', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'pr-number') return '';
      if (name === 'github-token') return 'test-token';
      return '';
    });
    mockGetBooleanInput.mockReturnValue(true);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('pr-number is required'),
    );
  });

  it('successful verification sets verified=true output', async () => {
    const prFixture = loadFixture('pr_dependabot.json');
    const commitsFixture = loadFixture('commits_verified.json');
    const headers = { 'x-ratelimit-remaining': '4999' };

    mockGetInput.mockImplementation((name: string) => {
      const map: Record<string, string> = {
        'pr-number': '42',
        'github-token': 'test-token',
        'expected-login': 'dependabot[bot]',
        'expected-id': '49699333',
        'allowed-committer-logins': 'web-flow',
        'github-api-url': 'https://api.github.com',
      };
      return map[name] ?? '';
    });
    mockGetBooleanInput.mockImplementation((name: string) => {
      const map: Record<string, boolean> = {
        'require-verified-commits': true,
        'require-same-repo': true,
        'fail-on-missing-author-metadata': true,
        'require-committer-login-match': false,
      };
      return map[name] ?? false;
    });

    const mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({ data: prFixture, headers }),
          listCommits: jest.fn().mockResolvedValue({ data: commitsFixture, headers }),
        },
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    await run();

    expect(mockSetOutput).toHaveBeenCalledWith('verified', 'true');
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it('failed verification (wrong login) calls setFailed', async () => {
    const prFixture = loadFixture('pr_dependabot.json');
    const commitsFixture = loadFixture('commits_verified.json');
    const headers = { 'x-ratelimit-remaining': '4999' };

    mockGetInput.mockImplementation((name: string) => {
      const map: Record<string, string> = {
        'pr-number': '42',
        'github-token': 'test-token',
        'expected-login': 'not-dependabot',
        'expected-id': '49699333',
        'allowed-committer-logins': 'web-flow',
        'github-api-url': 'https://api.github.com',
      };
      return map[name] ?? '';
    });
    mockGetBooleanInput.mockImplementation((name: string) => {
      const map: Record<string, boolean> = {
        'require-verified-commits': true,
        'require-same-repo': true,
        'fail-on-missing-author-metadata': true,
        'require-committer-login-match': false,
      };
      return map[name] ?? false;
    });

    const mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({ data: prFixture, headers }),
          listCommits: jest.fn().mockResolvedValue({ data: commitsFixture, headers }),
        },
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('does not match'),
    );
    expect(mockSetOutput).toHaveBeenCalledWith('verified', 'false');
  });

  it('invalid pr-number (NaN) calls setFailed', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'pr-number') return 'not-a-number';
      if (name === 'github-token') return 'test-token';
      return '';
    });
    mockGetBooleanInput.mockReturnValue(true);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('must be a positive integer'),
    );
  });

  it('invalid expected-id (NaN) calls setFailed', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const map: Record<string, string> = {
        'pr-number': '42',
        'github-token': 'test-token',
        'expected-login': 'dependabot[bot]',
        'expected-id': 'not-a-number',
        'allowed-committer-logins': 'web-flow',
        'github-api-url': 'https://api.github.com',
      };
      return map[name] ?? '';
    });
    mockGetBooleanInput.mockReturnValue(true);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('expected-id must be a positive integer'),
    );
  });

  it('non-Error thrown is handled gracefully', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const map: Record<string, string> = {
        'pr-number': '42',
        'github-token': 'test-token',
        'expected-login': 'dependabot[bot]',
        'expected-id': '49699333',
        'allowed-committer-logins': 'web-flow',
        'github-api-url': 'https://api.github.com',
      };
      return map[name] ?? '';
    });
    mockGetBooleanInput.mockImplementation((name: string) => {
      const map: Record<string, boolean> = {
        'require-verified-commits': true,
        'require-same-repo': true,
        'fail-on-missing-author-metadata': true,
        'require-committer-login-match': false,
      };
      return map[name] ?? false;
    });

    // Throw a non-Error value from the API call
    const mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn().mockRejectedValue('string-error'),
          listCommits: jest.fn(),
        },
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith('An unexpected error occurred.');
  });
});
