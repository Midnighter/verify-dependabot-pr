/**
 * Typed interfaces for the verify-dependabot-pr action.
 */

/** Action input configuration parsed from workflow inputs. */
export interface ActionInputs {
  githubToken: string;
  prNumber: number;
  headSha: string;
  expectedId: number;
  expectedWebFlowId: number;
}

/** Minimal PR data needed for verification. */
export interface PullRequest {
  number: number;
  /** Total number of commits on the PR, as GitHub counts them. */
  commits: number;
  user: {
    login: string;
    id: number;
    type: string;
  };
  head: {
    sha: string;
    /** The head branch's name, without the refs/heads/ prefix. */
    ref: string;
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

/**
 * One entry from the repository activity endpoint, which records what moved a
 * branch and who did it.
 */
export interface RepositoryActivity {
  activity_type: string;
  /** The commit the branch pointed at afterwards. */
  after: string;
  actor: CommitUser | null;
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
