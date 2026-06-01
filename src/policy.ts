import * as core from '@actions/core';
import {
  MAX_COMMITS_PER_PR,
  type ActionInputs,
  type PullRequest,
  type PullRequestCommit,
  type VerificationResult,
} from './types';

/**
 * Run all verification rules against the PR and its commits.
 * Returns the first failure or a success result.
 */
export function verifyPolicy(
  inputs: ActionInputs,
  pr: PullRequest,
  commits: PullRequestCommit[],
): VerificationResult {
  core.debug('Policy rules active:');
  core.debug(`  expectedLogin: "${inputs.expectedLogin}"`);
  core.debug(`  expectedId: ${inputs.expectedId}`);
  core.debug(`  requireVerifiedCommits: ${inputs.requireVerifiedCommits}`);
  core.debug(`  requireSameRepo: ${inputs.requireSameRepo}`);
  core.debug(`  failOnMissingAuthorMetadata: ${inputs.failOnMissingAuthorMetadata}`);
  core.debug(`  requireCommitterLoginMatch: ${inputs.requireCommitterLoginMatch}`);
  core.debug(`  allowedCommitterLogins: [${inputs.allowedCommitterLogins.join(', ')}]`);
  core.debug(`  commits to check: ${commits.length}`);

  const checkedCommitCount = commits.length;

  // Rule 0: Non-empty commit list
  if (commits.length === 0) {
    return { verified: false, reason: 'PR has no commits.', checkedCommitCount: 0 };
  }

  // Hard fail if commits hit the API maximum and verification is required
  if (inputs.requireVerifiedCommits && commits.length >= MAX_COMMITS_PER_PR) {
    return {
      verified: false,
      reason: `PR has ${commits.length} commits (API maximum ${MAX_COMMITS_PER_PR}). Cannot guarantee all commits have been verified.`,
      checkedCommitCount,
    };
  }

  // Rule 1: PR author login
  if (pr.user.login !== inputs.expectedLogin) {
    return {
      verified: false,
      reason: `PR author login "${pr.user.login}" does not match expected "${inputs.expectedLogin}".`,
      checkedCommitCount,
    };
  }

  // Rule 2: PR author account ID
  if (pr.user.id !== inputs.expectedId) {
    return {
      verified: false,
      reason: `PR author ID ${pr.user.id} does not match expected ID ${inputs.expectedId}.`,
      checkedCommitCount,
    };
  }

  // Rule 3: Same-repo check
  if (inputs.requireSameRepo) {
    if (pr.head.repo === null) {
      return {
        verified: false,
        reason: 'PR head repo is null (fork may have been deleted). Fork PRs are not allowed.',
        checkedCommitCount,
      };
    }
    if (pr.head.repo.full_name !== pr.base.repo.full_name) {
      return {
        verified: false,
        reason: `PR head repo "${pr.head.repo.full_name}" differs from base repo "${pr.base.repo.full_name}". Fork PRs are not allowed.`,
        checkedCommitCount,
      };
    }
  }

  // Per-commit rules
  for (const commit of commits) {
    // Rule 6: Null metadata guard (checked before login match)
    if (inputs.failOnMissingAuthorMetadata) {
      if (commit.author === null) {
        return {
          verified: false,
          reason: `Commit ${commit.sha} has null author metadata.`,
          checkedCommitCount,
        };
      }
      if (commit.committer === null) {
        return {
          verified: false,
          reason: `Commit ${commit.sha} has null committer metadata.`,
          checkedCommitCount,
        };
      }
    }

    // Rule 4: Commit author login
    if (commit.author !== null && commit.author.login !== inputs.expectedLogin) {
      return {
        verified: false,
        reason: `Commit ${commit.sha} author login "${commit.author.login}" does not match expected "${inputs.expectedLogin}".`,
        checkedCommitCount,
      };
    }

    // Rule 5: Commit committer login match
    if (inputs.requireCommitterLoginMatch && commit.committer !== null) {
      const committerLogin = commit.committer.login;
      if (
        committerLogin !== inputs.expectedLogin &&
        !inputs.allowedCommitterLogins.includes(committerLogin)
      ) {
        return {
          verified: false,
          reason: `Commit ${commit.sha} committer login "${committerLogin}" is not in the allowed list.`,
          checkedCommitCount,
        };
      }
    }

    // Rule 7: Commit verification
    if (inputs.requireVerifiedCommits) {
      if (!commit.commit.verification.verified) {
        return {
          verified: false,
          reason: `Commit ${commit.sha} is not verified (reason: ${commit.commit.verification.reason}).`,
          checkedCommitCount,
        };
      }
    }
  }

  return { verified: true, reason: '', checkedCommitCount };
}
