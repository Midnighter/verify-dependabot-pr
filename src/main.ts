import * as core from '@actions/core';
import * as github from '@actions/github';
import { createClient, fetchPullRequest, fetchAllCommits } from './github';
import { DEPENDABOT_ID_ON_GITHUB_COM, verifyPolicy } from './policy';
import type { ActionInputs } from './types';

/**
 * Parse a whole number greater than zero, or return null.
 *
 * parseInt stops at the first character it cannot read, so it turns "12abc"
 * into 12 and "1e3" into 1. An input GitHub never produces means the workflow
 * passed something unintended, so reject it rather than act on a prefix.
 */
function parsePositiveInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseInputs(): ActionInputs {
  const prNumberRaw = core.getInput('pr-number');
  if (!prNumberRaw) {
    throw new Error(
      'pr-number is required — this action must run on pull_request events.',
    );
  }

  const prNumber = parsePositiveInteger(prNumberRaw);
  if (prNumber === null) {
    throw new Error(`pr-number must be a positive integer, got "${prNumberRaw}".`);
  }

  const headSha = core.getInput('head-sha');
  if (!headSha) {
    throw new Error(
      'head-sha is required — this action must run on pull_request events.',
    );
  }

  const expectedIdRaw = core.getInput('expected-id');
  const expectedId = parsePositiveInteger(expectedIdRaw);
  if (expectedId === null) {
    throw new Error(`expected-id must be a positive integer, got "${expectedIdRaw}".`);
  }

  // Only a GHES instance has its own Dependabot account.
  if (
    github.context.serverUrl === 'https://github.com' &&
    expectedId !== DEPENDABOT_ID_ON_GITHUB_COM
  ) {
    throw new Error(
      `expected-id must be ${DEPENDABOT_ID_ON_GITHUB_COM} on GitHub.com, got ${expectedId}. Set it only on GitHub Enterprise Server.`,
    );
  }

  return {
    githubToken: core.getInput('github-token', { required: true }),
    prNumber,
    headSha,
    expectedId,
  };
}

export async function run(): Promise<void> {
  try {
    const inputs = parseInputs();

    const { owner, repo } = github.context.repo;
    const octokit = createClient(inputs.githubToken);

    core.info(`Verifying PR #${inputs.prNumber} in ${owner}/${repo}...`);

    const pr = await fetchPullRequest(octokit, owner, repo, inputs.prNumber);
    const commits = await fetchAllCommits(octokit, owner, repo, inputs.prNumber);

    core.info(`Fetched ${commits.length} commit(s).`);

    const result = verifyPolicy(inputs, pr, commits);

    core.setOutput('verified', String(result.verified));
    core.setOutput('reason', result.reason);
    core.setOutput('checked-commit-count', String(result.checkedCommitCount));
    core.setOutput('head-sha', result.verified ? pr.head.sha : '');

    if (result.verified) {
      core.info('✅ PR verified as genuine Dependabot PR.');
    } else {
      core.setFailed(`❌ Verification failed: ${result.reason}`);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.';
    // A consumer with continue-on-error must not read a missing output as a pass.
    core.setOutput('verified', 'false');
    core.setOutput('reason', message);
    core.setFailed(message);
  }
}

/* istanbul ignore next -- entry point guard */
if (!process.env.JEST_WORKER_ID) {
  run();
}
