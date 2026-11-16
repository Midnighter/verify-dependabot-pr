#!/usr/bin/env bash
#
# Merges open, passing Dependabot PRs into main one at a time:
#
#   1. Comment "@dependabot rebase" on the PR so its branch is rebased onto
#      the current tip of main (dependabot re-signs the commit itself).
#   2. Wait for dependabot to push the rebased commit and for required
#      checks ("ci (24)", "ci (26)") to pass.
#   3. Check every commit on the PR with the action's rules: verified,
#      authored by Dependabot, committed by web-flow or Dependabot, and the
#      last one is the commit that passed the checks.
#   4. Approve that commit and fast-forward main to it
#      (git push origin <sha>:refs/heads/main) - no merge commit, no squash,
#      preserving dependabot's original signature.
#
# main's ruleset (id 17334798) requires linear history and signed commits;
# a direct fast-forward push of an already-signed commit satisfies both.
# The push goes through the admin bypass, so the script pushes the exact
# commit it checked, never the branch, which may have moved since.
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

# Succeeds when the PR's commits end at the given SHA and each one is a commit
# GitHub verified with Dependabot as author and web-flow or Dependabot as
# committer: the same rules as the action.
check_commits() {
  local pr=$1 head=$2 total
  total=$(gh api "repos/${REPO}/pulls/${pr}" --jq .commits)
  gh api --paginate --slurp "repos/${REPO}/pulls/${pr}/commits?per_page=100" |
    jq --exit-status --arg head "${head}" --argjson total "${total}" \
      --argjson id "${DEPENDABOT_ID}" '
      add
      | length == $total
        and .[-1].sha == $head
        and all(.[];
          .author.login == "dependabot[bot]" and .author.id == $id
          and .commit.verification.verified
          and (.committer.login == "web-flow"
            or (.committer.login == "dependabot[bot]" and .committer.id == $id)))' \
      >/dev/null
}

for pr in "${PR_NUMBERS[@]}"; do
  echo "== PR #${pr} =="

  pr_data=$(gh api "repos/${REPO}/pulls/${pr}" \
    --jq '[.head.ref, (.user.id | tostring), .state, .base.ref, .head.repo.full_name] | @tsv')
  IFS=$'\t' read -r branch author_id state base_ref head_repo <<<"${pr_data}"

  if [[ "${author_id}" != "${DEPENDABOT_ID}" || "${state}" != "open" || "${base_ref}" != "main" || "${head_repo,,}" != "${REPO,,}" ]]; then
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

  if ! check_commits "${pr}" "${after_sha}"; then
    echo "  skipping PR #${pr}: not every commit up to ${after_sha:0:7} is a verified Dependabot commit"
    continue
  fi

  # Approve and push the checked commit, not wherever the branch points now.
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
