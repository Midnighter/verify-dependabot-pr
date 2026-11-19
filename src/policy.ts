import {
  MAX_COMMITS_PER_PR,
  type ActionInputs,
  type PullRequest,
  type PullRequestCommit,
  type VerificationResult,
} from './types';

export const DEPENDABOT_LOGIN = 'dependabot[bot]';

/** Dependabot's account ID on GitHub.com. GHES instances have their own. */
export const DEPENDABOT_ID_ON_GITHUB_COM = 49699333;

/** GitHub's committer on the commits it creates and signs, such as Dependabot's. */
const WEB_FLOW_LOGIN = 'web-flow';

/** web-flow's account ID on GitHub.com. GHES instances have their own. */
export const WEB_FLOW_ID_ON_GITHUB_COM = 19864447;

/**
 * Run all verification rules against the PR and its commits.
 * Returns the first failure or a success result.
 */
export function verifyPolicy(
  inputs: ActionInputs,
  pr: PullRequest,
  commits: PullRequestCommit[],
): VerificationResult {
  const checkedCommitCount = commits.length;
  const fail = (reason: string): VerificationResult => ({
    verified: false,
    reason,
    checkedCommitCount,
  });

  if (commits.length === 0) {
    return fail('PR has no commits.');
  }

  if (commits.length >= MAX_COMMITS_PER_PR) {
    return fail(
      `PR has ${commits.length} commits (API maximum ${MAX_COMMITS_PER_PR}). Cannot guarantee all commits have been verified.`,
    );
  }

  // Catches a list cut short by the API and a push between the two API calls.
  if (commits.length !== pr.commits) {
    return fail(
      `PR has ${pr.commits} commits, but the API listed ${commits.length}. Not every commit could be checked.`,
    );
  }

  if (pr.user.login !== DEPENDABOT_LOGIN) {
    return fail(
      `PR author login "${pr.user.login}" does not match "${DEPENDABOT_LOGIN}".`,
    );
  }

  if (pr.user.type !== 'Bot') {
    return fail(`PR author type "${pr.user.type}" is not "Bot".`);
  }

  if (pr.user.id !== inputs.expectedId) {
    return fail(
      `PR author ID ${pr.user.id} does not match expected ID ${inputs.expectedId}.`,
    );
  }

  // Dependabot pushes its branches to the repository itself. Compare IDs,
  // because a repository's name can change.
  if (pr.head.repo === null) {
    return fail(
      'PR head repo is null (fork may have been deleted). Fork PRs are not allowed.',
    );
  }
  if (pr.head.repo.id !== pr.base.repo.id) {
    return fail(
      `PR head repo "${pr.head.repo.full_name}" (ID ${pr.head.repo.id}) differs from base repo "${pr.base.repo.full_name}" (ID ${pr.base.repo.id}). Fork PRs are not allowed.`,
    );
  }

  // The result must cover exactly the commit the workflow ran for. The PR can
  // move between the event and these API calls, or between the two calls.
  if (pr.head.sha !== inputs.headSha) {
    return fail(
      `PR head ${pr.head.sha} is not the head commit ${inputs.headSha} that the workflow ran for. The PR changed; verify it again.`,
    );
  }
  const lastSha = commits[commits.length - 1].sha;
  if (lastSha !== pr.head.sha) {
    return fail(`The last listed commit ${lastSha} is not the PR head ${pr.head.sha}.`);
  }

  // A commit's author and committer are whatever it claims, unless GitHub
  // verified its signature, and then the committer is the key's owner. So
  // only a verified commit with Dependabot as author and web-flow or
  // Dependabot as committer comes from Dependabot.
  for (const commit of commits) {
    const { author, committer } = commit;
    if (author === null) {
      return fail(`Commit ${commit.sha} has null author metadata.`);
    }
    if (committer === null) {
      return fail(`Commit ${commit.sha} has null committer metadata.`);
    }
    if (author.login !== DEPENDABOT_LOGIN) {
      return fail(
        `Commit ${commit.sha} author login "${author.login}" does not match "${DEPENDABOT_LOGIN}".`,
      );
    }
    if (author.id !== inputs.expectedId) {
      return fail(
        `Commit ${commit.sha} author ID ${author.id} does not match expected ID ${inputs.expectedId}.`,
      );
    }
    if (
      committer.login !== WEB_FLOW_LOGIN &&
      !(committer.login === DEPENDABOT_LOGIN && committer.id === inputs.expectedId)
    ) {
      return fail(
        `Commit ${commit.sha} committer "${committer.login}" (ID ${committer.id}) is neither ${WEB_FLOW_LOGIN} nor Dependabot.`,
      );
    }
    // The login alone proves nothing: GitHub resolves it from the commit's
    // email, so a commit can claim web-flow as its committer. Only the account
    // ID pins it to the instance's real signing account.
    if (
      committer.login === WEB_FLOW_LOGIN &&
      committer.id !== inputs.expectedWebFlowId
    ) {
      return fail(
        `Commit ${commit.sha} committer "${WEB_FLOW_LOGIN}" has ID ${committer.id}, not ${inputs.expectedWebFlowId}.`,
      );
    }
    if (commit.commit.verification.verified !== true) {
      return fail(
        `Commit ${commit.sha} is not verified (reason: ${commit.commit.verification.reason}).`,
      );
    }
  }

  return { verified: true, reason: '', checkedCommitCount };
}
