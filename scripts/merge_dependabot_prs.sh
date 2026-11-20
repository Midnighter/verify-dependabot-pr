#!/usr/bin/env bash
#
# Fast-forwards main onto Dependabot PRs you have already reviewed, one at a
# time, so that dependabot's own signed commits land unchanged:
#
#   1. Comment "@dependabot rebase" on the PR so its branch is rebased onto
#      the current tip of main (dependabot re-signs the commit itself).
#   2. Wait for dependabot to push the rebased commit and for required
#      checks ("ci (24)", "ci (26)") to pass.
#   3. Approve that commit and fast-forward main to it
#      (git push origin <sha>:refs/heads/main) - no merge commit, no squash,
#      preserving dependabot's original signature.
#
# It does not check that the commits came from Dependabot. Two things already
# do: this repository's own action, which runs on every PR, and your reading of
# the diff before you call this script. The script deliberately keeps no copy
# of the action's rules. A copy drifts from src/policy.ts - this one twice lost
# rules the action had - and the machinery needed to stop it drifting costs
# more than the convenience is worth.
#
# What it does check is mechanical, and independent of any review: that the PR
# is an open, same-repository Dependabot PR targeting main, and that it
# approves and pushes the exact commit whose checks passed rather than wherever
# the branch has moved to since.
#
# main's ruleset (id 17334798) requires linear history and signed commits;
# a direct fast-forward push of an already-signed commit satisfies both. The
# push goes through the admin bypass, so main's required status checks do not
# gate it. Review the PR before running this.
#
set -euo pipefail

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <PR number> [<PR number> ...]" >&2
  exit 2
fi
PR_NUMBERS=("$@")

REBASE_TIMEOUT=300 # seconds to wait for dependabot's rebase push
REBASE_POLL=10     # seconds between polls
CHECKS_TIMEOUT=120 # seconds to wait for CI runs to be registered after a push
DEPENDABOT_ID=49699333

for pr in "${PR_NUMBERS[@]}"; do
  echo "== PR #${pr} =="

  # head.repo is null when the PR comes from a deleted fork, so give it a
  # placeholder that cannot equal the base repo's ID.
  pr_data=$(gh api "repos/${REPO}/pulls/${pr}" \
    --jq '[.head.ref, (.user.id | tostring), .user.type, .state, .base.ref,
           (.head.repo.id // "none" | tostring), (.base.repo.id | tostring)] | @tsv')
  IFS=$'\t' read -r branch author_id author_type state base_ref head_repo_id base_repo_id <<<"${pr_data}"

  # Compare repositories by ID, because a repository can be renamed.
  if [[ "${author_id}" != "${DEPENDABOT_ID}" || "${author_type}" != "Bot" || "${state}" != "open" || "${base_ref}" != "main" || "${head_repo_id}" != "${base_repo_id}" ]]; then
    echo "  skipping PR #${pr}: not an open, same-repository Dependabot PR targeting main"
    continue
  fi

  git fetch origin -- "${branch}" main

  # Judge progress by whether the branch contains origin/main, not by a head
  # change: dependabot may already be rebasing (e.g. after main moved), so a
  # new head does not prove our request was handled. Re-request if the head
  # changed but is still behind main.
  elapsed=0
  requested_sha=""
  recreated=false
  while true; do
    after_sha=$(git rev-parse "origin/${branch}")
    if git merge-base --is-ancestor origin/main "origin/${branch}"; then
      break
    fi
    if (( elapsed >= REBASE_TIMEOUT )); then
      if [[ "${recreated}" == true ]]; then
        echo "  timed out waiting for recreate; skipping PR #${pr}"
        after_sha=""
        break
      fi
      # Dependabot sometimes ignores rebase requests; recreate rebuilds the PR.
      echo "  timed out waiting for rebase; requesting recreate"
      gh pr comment "${pr}" --repo "${REPO}" --body "@dependabot recreate"
      recreated=true
      elapsed=0
    fi
    if [[ "${requested_sha}" != "${after_sha}" ]]; then
      echo "  requesting rebase (current head: ${after_sha:0:7})"
      gh pr comment "${pr}" --repo "${REPO}" --body "@dependabot rebase"
      requested_sha="${after_sha}"
    fi
    sleep "${REBASE_POLL}"
    elapsed=$((elapsed + REBASE_POLL))
    git fetch origin -- "${branch}" main
  done

  if [[ -z "${after_sha}" ]]; then
    continue
  fi
  echo "  head at ${after_sha:0:7}, waiting on required checks..."

  # Right after a push, CI runs may not be registered yet, and
  # `gh pr checks --watch` fails immediately with "no checks reported".
  elapsed=0
  until gh pr checks "${pr}" --repo "${REPO}" --required >/dev/null 2>&1 ||
    [[ "$(gh pr checks "${pr}" --repo "${REPO}" --required 2>&1)" != *"no checks reported"* ]]; do
    if (( elapsed >= CHECKS_TIMEOUT )); then
      echo "  no checks appeared within ${CHECKS_TIMEOUT}s"
      break
    fi
    sleep "${REBASE_POLL}"
    elapsed=$((elapsed + REBASE_POLL))
  done

  if ! gh pr checks "${pr}" --repo "${REPO}" --required --watch; then
    echo "  skipping PR #${pr}: required checks not passing"
    continue
  fi

  current_sha=$(gh pr view "${pr}" --repo "${REPO}" --json headRefOid --jq '.headRefOid')
  if [[ "${current_sha}" != "${after_sha}" ]]; then
    echo "  skipping PR #${pr}: PR head changed while waiting for checks (${after_sha:0:7} -> ${current_sha:0:7})"
    continue
  fi

  # Approve and push the commit whose checks passed, not wherever the branch
  # points now.
  gh api --method POST "repos/${REPO}/pulls/${pr}/reviews" \
    -f commit_id="${after_sha}" -f event=APPROVE --silent

  git fetch origin -- main

  if ! git merge-base --is-ancestor origin/main "${after_sha}"; then
    echo "  skipping PR #${pr}: ${after_sha:0:7} is not a fast-forward of main"
    continue
  fi

  git push origin "${after_sha}:refs/heads/main"
  echo "  merged."
done
