#!/usr/bin/env bash
#
# Runs the built action against this repository's own pull requests and checks
# that it still reaches the right verdict on real GitHub data.
#
# The unit and acceptance suites feed fixtures to a mocked Octokit, so they
# confirm the policy matches our model of GitHub rather than GitHub itself. The
# failure this catches is a rule tightened until it rejects genuine Dependabot
# pull requests: every fixture-based test would still pass, and auto-merge would
# quietly stop working for consumers.
#
# It runs dist/index.js, not src/, so what it exercises is what consumers run:
# input parsing, the real Octokit client, the policy and the step outputs.
#
# The anchors are the newest merged Dependabot pull requests, chosen at run
# time rather than written down here. A merged pull request is frozen, where an
# open one moves as Dependabot rebases it, but a fixed list of them ages: the
# policy reads who pushed the head branch from the repository's activity, which
# goes back a limited time, so a named pull request would eventually be
# rejected for being old and fail this check with nothing wrong in the code.
# Selecting the newest few keeps the anchors inside that window for as long as
# Dependabot opens pull requests at all.
#
# The selection asks only what the pull request is, never what the action makes
# of it: merged, authored by Dependabot, targeting main. Dropping a pull
# request because it fails would turn this check into a tautology.
#
# Needs a built dist/ (npm run build) and GH_TOKEN with read access to this
# repository's contents and pull requests.
#
#   scripts/verify_live_prs.sh
#
set -euo pipefail

REPO="Midnighter/verify-dependabot-pr"

# How many anchors to check, and the fewest that make the result mean
# anything. Finding none must fail: a check that silently verifies nothing
# reports success for the rest of the repository's life.
ANCHOR_COUNT=5
MIN_ANCHORS=3

# Newest merged Dependabot pull requests first. The REST list is ordered by
# creation, and Dependabot's rebases mean the two orders differ.
readonly ANCHOR_FILTER='[.[] | select(.merged_at != null and .user.login == "dependabot[bot]")]
  | sort_by(.merged_at) | reverse'

# A pull request a person opened, which must not verify. Named rather than
# selected, because a human pull request's verdict does not age: it is rejected
# for its author, whatever the activity API still holds.
REJECTED_PR=104

# Every input's literal default from action.yml, as INPUT_* assignments, so that
# adding an input does not leave this check running with inputs a real workflow
# would never have. Defaults holding a `${{ }}` expression are skipped; the
# per-PR values below supply those.
# shellcheck disable=SC2016  # This is JavaScript; shell must not expand it.
readonly ACTION_DEFAULTS_SCRIPT='
const { parse } = require("yaml");
const { inputs } = parse(require("fs").readFileSync("action.yml", "utf-8"));
for (const [name, input] of Object.entries(inputs)) {
  const value = input.default;
  if (value === undefined || String(value).includes("${{")) continue;
  process.stdout.write(`INPUT_${name.toUpperCase()}=${value}\0`);
}
'

if [[ ! -f dist/index.js ]]; then
  echo "dist/index.js is missing; run npm run build first." >&2
  exit 2
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN is not set." >&2
  exit 2
fi

action_defaults=()
while IFS= read -r -d '' assignment; do
  action_defaults+=("${assignment}")
done < <(node --input-type=commonjs -e "${ACTION_DEFAULTS_SCRIPT}")

failed=0

# Runs the action for one PR and prints whether the verdict was the wanted one.
# The action reads inputs from INPUT_* and writes outputs to GITHUB_OUTPUT, the
# same way the runner invokes it.
check_pr() {
  local pr=$1 want=$2 head outputs log verified reason

  head=$(gh api "repos/${REPO}/pulls/${pr}" --jq .head.sha)
  outputs=$(mktemp)
  log=$(mktemp)

  # The action exits non-zero when it does not verify, which is not a failure
  # of this script, so the exit status is ignored and the outputs are read
  # instead.
  env "${action_defaults[@]}" \
    GITHUB_REPOSITORY="${REPO}" \
    GITHUB_SERVER_URL="https://github.com" \
    GITHUB_API_URL="https://api.github.com" \
    GITHUB_OUTPUT="${outputs}" \
    "INPUT_GITHUB-TOKEN=${GH_TOKEN}" \
    "INPUT_PR-NUMBER=${pr}" \
    "INPUT_HEAD-SHA=${head}" \
    node dist/index.js >"${log}" 2>&1 || true

  # GITHUB_OUTPUT holds `name<<delimiter`, the value, then the delimiter again.
  verified=$(awk '/^verified<</{getline; print; exit}' "${outputs}")
  reason=$(awk '/^reason<</{getline; print; exit}' "${outputs}")

  if [[ "${verified}" == "${want}" ]]; then
    printf 'ok    PR #%-4s verified=%-5s %s\n' "${pr}" "${verified}" "${reason}"
  else
    printf 'FAIL  PR #%-4s verified=%-5s wanted %s. %s\n' \
      "${pr}" "${verified:-<none>}" "${want}" "${reason}"
    sed 's/^/        /' "${log}"
    failed=1
  fi

  rm -f "${outputs}" "${log}"
}

mapfile -t verified_prs < <(
  gh api "repos/${REPO}/pulls?state=closed&base=main&per_page=100" \
    --jq "${ANCHOR_FILTER} | .[0:${ANCHOR_COUNT}] | .[].number"
)

if ((${#verified_prs[@]} < MIN_ANCHORS)); then
  echo "Found ${#verified_prs[@]} merged Dependabot PR(s) to check, need ${MIN_ANCHORS}." >&2
  exit 2
fi

echo "Merged Dependabot PRs, which must verify:"
for pr in "${verified_prs[@]}"; do
  check_pr "${pr}" true
done

echo "A PR a person opened, which must not verify:"
check_pr "${REJECTED_PR}" false

exit "${failed}"
