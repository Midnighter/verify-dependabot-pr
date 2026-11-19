#!/usr/bin/env bash
#
# Runs scripts/merge_dependabot_prs.sh against crafted pull requests and checks
# that it merges or skips each one as intended.
#
# This covers the script's decisions — which pull requests it will touch, and
# whether it reaches the push — not whether its commit rules match the action's.
# That comparison is tests/unit/merge-script.test.ts, which runs the same jq
# filter and verifyPolicy over the same fixtures.
#
# `gh` and `git` are replaced by stubs on PATH, so no network or repository is
# needed and nothing can be pushed. The push stub prints MERGED, which is the
# only signal a case reads as success: it stands in for a fast-forward of main,
# so a change that makes it run for real is what these cases exist to catch.
#
#   scripts/verify_merge_rules.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly MERGE_SCRIPT="${SCRIPT_DIR}/merge_dependabot_prs.sh"

# The values the script's own constants use, so a case reads as genuine unless
# it deliberately varies one.
readonly DEPENDABOT_ID=49699333
readonly WEB_FLOW_ID=19864447
readonly BASE_REPO_ID=1260740686
readonly HEAD_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
export HEAD_SHA

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
mkdir -p "${work}/bin"
PATH="${work}/bin:${PATH}"

# Serves PR_JSON for the pull request endpoint and COMMITS_JSON for its
# commits, and applies whatever --jq filter the script asked for, so the script
# parses its own real output. Everything that would change state succeeds
# silently.
cat >"${work}/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *"repo view"*) echo "Midnighter/verify-dependabot-pr"; exit 0 ;;
  *"pr checks"* | *"pr comment"* | *"--method POST"*) exit 0 ;;
  *"pr view"*) echo "${HEAD_SHA}"; exit 0 ;;
esac

json=""
for arg in "$@"; do
  case "${arg}" in
    *"/commits?"*) json="${COMMITS_JSON}" ;;
    */pulls/*) [[ -z "${json}" ]] && json="${PR_JSON}" ;;
  esac
done

filter="."
previous=""
for arg in "$@"; do
  [[ "${previous}" == "--jq" ]] && filter="${arg}"
  previous="${arg}"
done

# --slurp hands the filter an array of pages.
if [[ "$*" == *"--slurp"* ]]; then
  printf '%s' "[${json}]" | jq -r "${filter}"
else
  printf '%s' "${json}" | jq -r "${filter}"
fi
STUB

# The branch always looks rebased onto main, so the wait loop exits at once and
# a case is decided by the rules rather than by a timeout.
cat >"${work}/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  rev-parse) echo "${HEAD_SHA}" ;;
  push) echo "MERGED $3" ;;
esac
exit 0
STUB
chmod +x "${work}/bin/gh" "${work}/bin/git"

# A pull request as the API returns it. head.repo is null when the pull request
# comes from a fork whose repository is gone.
pull_request() { # author type, head repo ID or null, commit count
  jq --null-input --arg type "$1" --argjson head_repo "$2" --argjson commits "$3" \
    --argjson id "${DEPENDABOT_ID}" --argjson base_repo "${BASE_REPO_ID}" \
    '{
      head: {
        ref: "dependabot/npm_and_yarn/example",
        repo: (if $head_repo == null then null else { id: $head_repo } end),
      },
      user: { login: "dependabot[bot]", id: $id, type: $type },
      state: "open",
      base: { ref: "main", repo: { id: $base_repo } },
      commits: $commits,
    }'
}

# A commit list every rule accepts, ending at the head commit.
commits() { # how many
  jq --null-input --argjson count "$1" --arg head "${HEAD_SHA}" \
    --argjson id "${DEPENDABOT_ID}" --argjson web_flow_id "${WEB_FLOW_ID}" \
    '[range($count) | {
      sha: (if . == ($count - 1) then $head else "sha\(.)" end),
      author: { login: "dependabot[bot]", id: $id },
      committer: { login: "web-flow", id: $web_flow_id },
      commit: { message: "deps: bump example", verification: { verified: true, reason: "valid" } },
    }]'
}

failed=0

# Runs the merge script for one crafted pull request. A case passes when the
# script did what it was meant to: "merge" means it reached the push, "skip"
# means it declined.
case_runs() { # name, merge|skip, PR JSON, commits JSON
  local name=$1 want=$2 output outcome
  export PR_JSON=$3 COMMITS_JSON=$4

  output=$("${MERGE_SCRIPT}" 42 2>&1)
  if grep -q '^MERGED' <<<"${output}"; then outcome=merge; else outcome=skip; fi

  if [[ "${outcome}" == "${want}" ]]; then
    printf 'ok    %-48s %s\n' "${name}" "${outcome}"
  else
    printf 'FAIL  %-48s %s, wanted %s\n' "${name}" "${outcome}" "${want}"
    printf '        %s\n' "${output}"
    failed=1
  fi
}

echo "Pull requests the script must merge:"
case_runs "a genuine single-commit PR" merge \
  "$(pull_request Bot "${BASE_REPO_ID}" 1)" "$(commits 1)"
case_runs "a genuine PR just under the commit cap" merge \
  "$(pull_request Bot "${BASE_REPO_ID}" 249)" "$(commits 249)"

echo "Pull requests the script must skip:"
case_runs "an author of type User holding Dependabot's ID" skip \
  "$(pull_request User "${BASE_REPO_ID}" 1)" "$(commits 1)"
case_runs "a fork, by head repository ID" skip \
  "$(pull_request Bot 999999 1)" "$(commits 1)"
case_runs "a fork whose repository was deleted" skip \
  "$(pull_request Bot null 1)" "$(commits 1)"
case_runs "a PR at the commit cap" skip \
  "$(pull_request Bot "${BASE_REPO_ID}" 250)" "$(commits 250)"
case_runs "a PR with no commits" skip \
  "$(pull_request Bot "${BASE_REPO_ID}" 0)" "$(commits 0)"
case_runs "a commit list shorter than the PR's own count" skip \
  "$(pull_request Bot "${BASE_REPO_ID}" 3)" "$(commits 2)"

exit "${failed}"
