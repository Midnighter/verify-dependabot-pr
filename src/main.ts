import * as core from '@actions/core';
import * as github from '@actions/github';
import { createClient, fetchPullRequest, fetchAllCommits } from './github';
import { verifyPolicy } from './policy';
import type { ActionInputs } from './types';

function parseInputs(): ActionInputs {
  const prNumberRaw = core.getInput('pr-number');
  if (!prNumberRaw) {
    throw new Error(
      'pr-number is required — this action must run on pull_request events.',
    );
  }

  const prNumber = parseInt(prNumberRaw, 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    throw new Error(`pr-number must be a positive integer, got "${prNumberRaw}".`);
  }

  const expectedIdRaw = core.getInput('expected-id');
  const expectedId = parseInt(expectedIdRaw, 10);
  if (isNaN(expectedId) || expectedId <= 0) {
    throw new Error(
      `expected-id must be a positive integer, got "${expectedIdRaw}".`,
    );
  }

  const allowedCommitterLoginsRaw = core.getInput('allowed-committer-logins');
  const allowedCommitterLogins = allowedCommitterLoginsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    githubToken: core.getInput('github-token', { required: true }),
    prNumber,
    expectedLogin: core.getInput('expected-login'),
    expectedId,
    requireVerifiedCommits: core.getBooleanInput('require-verified-commits'),
    requireSameRepo: core.getBooleanInput('require-same-repo'),
    failOnMissingAuthorMetadata: core.getBooleanInput(
      'fail-on-missing-author-metadata',
    ),
    requireCommitterLoginMatch: core.getBooleanInput(
      'require-committer-login-match',
    ),
    allowedCommitterLogins,
    githubApiUrl: core.getInput('github-api-url'),
  };
}

export async function run(): Promise<void> {
  try {
    const inputs = parseInputs();

    const { owner, repo } = github.context.repo;
    const octokit = createClient(inputs.githubToken, inputs.githubApiUrl);

    core.info(`Verifying PR #${inputs.prNumber} in ${owner}/${repo}...`);

    const pr = await fetchPullRequest(octokit, owner, repo, inputs.prNumber);
    const commits = await fetchAllCommits(octokit, owner, repo, inputs.prNumber);

    core.info(`Fetched ${commits.length} commit(s).`);

    const result = verifyPolicy(inputs, pr, commits);

    core.setOutput('verified', String(result.verified));
    core.setOutput('reason', result.reason);
    core.setOutput('checked-commit-count', String(result.checkedCommitCount));

    if (result.verified) {
      core.info('✅ PR verified as genuine Dependabot PR.');
    } else {
      core.setFailed(`❌ Verification failed: ${result.reason}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred.');
    }
  }
}

/* istanbul ignore next -- entry point guard */
if (!process.env.JEST_WORKER_ID) {
  run();
}
