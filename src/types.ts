/**
 * Typed interfaces for the verify-dependabot-pr action.
 */

/** Action input configuration parsed from workflow inputs. */
export interface ActionInputs {
  githubToken: string;
  prNumber: number;
  headSha: string;
  expectedId: number;
}

/** Minimal PR data needed for verification. */
export interface PullRequest {
  number: number;
  user: {
    login: string;
    id: number;
    type: string;
  };
  head: {
    sha: string;
    repo: {
      id: number;
      full_name: string;
    } | null;
  };
  base: {
    repo: {
      id: number;
      full_name: string;
    };
  };
}

/** Commit verification metadata. */
export interface CommitVerification {
  verified: boolean;
  reason: string;
}

/** Commit author/committer identity. */
export interface CommitUser {
  login: string;
  id: number;
}

/** A single commit from the PR commits endpoint. */
export interface PullRequestCommit {
  sha: string;
  commit: {
    message: string;
    verification: CommitVerification;
  };
  author: CommitUser | null;
  committer: CommitUser | null;
}

/** Result of the policy verification. */
export interface VerificationResult {
  verified: boolean;
  reason: string;
  checkedCommitCount: number;
}

/**
 * Maximum number of commits the GitHub REST API returns per PR.
 * Beyond this limit, we cannot guarantee completeness.
 */
export const MAX_COMMITS_PER_PR = 250;
