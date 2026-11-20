#!/usr/bin/env bash
#
# Runs scripts/merge_dependabot_prs.sh against crafted pull requests and checks
# that it merges or skips each one as intended.
#
# The merge script keeps no copy of the action's commit rules, so there is
# nothing here about signatures or commit authorship. What it does cover is the
# script's mechanical safety, which holds whether or not a PR was reviewed:
# which pull requests it will touch at all, and that it pushes the exact commit
# whose checks passed rather than wherever the branch has moved to since.
#
# `gh` and `git` are replaced by stubs on PATH, so no network or repository is
# needed and nothing can be pushed. The push stub prints the ref it was given,
# which is the only signal a case reads as success: it stands in for a
# fast-forward of main, so a change that pushes the wrong commit, or pushes
# when it should not, is what these cases exist to catch.
#
#   scripts/verify_merge_script.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly MERGE_SCRIPT="${SCRIPT_DIR}/merge_dependabot_prs.sh"

readonly DEPENDABOT_ID=49699333
readonly BASE_REPO_ID=1260740686
readonly HEAD_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
readonly OTHER_SHA="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
export HEAD_SHA

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
mkdir -p "${work}/bin"
PATH="${work}/bin:${PATH}"

# Serves PR_JSON for the pull request endpoint and applies whatever --jq filter
# the script asked for, so the script parses its own real output. CHECKS_EXIT
# decides whether required checks pass, and PR_VIEW_SHA what the PR's head is
# by the time the script re-reads it. Everything that would change state
# succeeds silently.
cat >"${work}/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *"repo view"*) echo "Midnighter/verify-dependabot-pr"; exit 0 ;;
  *"pr checks"*) exit "${CHECKS_EXIT:-0}" ;;
  *"pr comment"* | *"--method POST"*) exit 0 ;;
  *"pr view"*) echo "${PR_VIEW_SHA:-${HEAD_SHA}}"; exit 0 ;;
esac

filter="."
previous=""
for arg in "$@"; do
  [[ "${previous}" == "--jq" ]] && filter="${arg}"
  previous="${arg}"
done

printf '%s' "${PR_JSON}" | jq -r "${filter}"
STUB

# The branch always looks rebased onto main, so the wait loop exits at once and
# a case is decided by the rules rather than by a timeout. The pre-push
# ancestry check asks about a commit SHA rather than the branch, and FF_EXIT
# decides that one, so a case can make the push a non-fast-forward.
cat >"${work}/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  rev-parse) echo "${HEAD_SHA}" ;;
  merge-base)
    case "${!#}" in
      origin/*) exit 0 ;;
      *) exit "${FF_EXIT:-0}" ;;
    esac
    ;;
  push) echo "PUSHED $3" ;;
esac
exit 0
STUB
chmod +x "${work}/bin/gh" "${work}/bin/git"

# A pull request as the API returns it. head.repo is null when the pull request
# comes from a fork whose repository is gone.
pull_request() { # author type, state, base ref, head repo ID or null
  jq --null-input --arg type "$1" --arg state "$2" --arg base_ref "$3" \
    --argjson head_repo "$4" --argjson id "${DEPENDABOT_ID}" \
    --argjson base_repo "${BASE_REPO_ID}" \
    '{
      head: {
        ref: "dependabot/npm_and_yarn/example",
        repo: (if $head_repo == null then null else { id: $head_repo } end),
      },
      user: { login: "dependabot[bot]", id: $id, type: $type },
      state: $state,
      base: { ref: $base_ref, repo: { id: $base_repo } },
    }'
}

# A pull request every guard accepts, as a base for cases that vary one thing.
genuine_pull_request() {
  pull_request Bot open main "${BASE_REPO_ID}"
}

failed=0

# Runs the merge script for one crafted pull request. "merge" means it reached
# the push with the commit it had checked; "skip" means it declined.
case_runs() { # name, merge|skip, PR JSON, env assignments...
  local name=$1 want=$2 pr_json=$3
  shift 3
  local output outcome

  # A pull_request call with a bad argument yields nothing, and the script then
  # skips because it could not read the PR, which would look like a pass.
  if ! jq --exit-status type >/dev/null 2>&1 <<<"${pr_json}"; then
    printf 'FAIL  %-50s the case built no pull request JSON\n' "${name}"
    failed=1
    return
  fi

  output=$(PR_JSON="${pr_json}" "$@" "${MERGE_SCRIPT}" 42 2>&1)
  if grep -q "^PUSHED ${HEAD_SHA}:refs/heads/main\$" <<<"${output}"; then
    outcome=merge
  elif grep -q '^PUSHED' <<<"${output}"; then
    outcome="pushed the wrong ref"
  else
    outcome=skip
  fi

  if [[ "${outcome}" == "${want}" ]]; then
    printf 'ok    %-50s %s\n' "${name}" "${outcome}"
  else
    printf 'FAIL  %-50s %s, wanted %s\n' "${name}" "${outcome}" "${want}"
    printf '        %s\n' "${output}"
    failed=1
  fi
}

echo "Pull requests the script must fast-forward main onto:"
case_runs "an open, same-repository Dependabot PR" merge \
  "$(genuine_pull_request)" env

echo "Pull requests the script must leave alone:"
case_runs "an author of type User holding Dependabot's ID" skip \
  "$(pull_request User open main "${BASE_REPO_ID}")" env
case_runs "a closed PR" skip \
  "$(pull_request Bot closed main "${BASE_REPO_ID}")" env
case_runs "a PR targeting a branch other than main" skip \
  "$(pull_request Bot open release "${BASE_REPO_ID}")" env
case_runs "a fork, by head repository ID" skip \
  "$(pull_request Bot open main 999999)" env
case_runs "a fork whose repository was deleted" skip \
  "$(pull_request Bot open main null)" env

echo "Conditions under which it must not push:"
case_runs "required checks are failing" skip \
  "$(genuine_pull_request)" env CHECKS_EXIT=1
case_runs "the PR head moved while checks ran" skip \
  "$(genuine_pull_request)" env "PR_VIEW_SHA=${OTHER_SHA}"
case_runs "the commit is not a fast-forward of main" skip \
  "$(genuine_pull_request)" env FF_EXIT=1

exit "${failed}"
