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
# The anchors are merged pull requests. An open one moves, because Dependabot
# rebases it and its head commit changes, so a case naming one would eventually
# fail on its own. A merged pull request is frozen, and stays usable after its
# head branch is deleted, because the policy compares head.repo.id and never
# reads the branch.
#
# Needs a built dist/ (npm run build) and GH_TOKEN with read access to this
# repository's contents and pull requests.
#
#   scripts/verify_live_prs.sh
#
set -euo pipefail

REPO="Midnighter/verify-dependabot-pr"

# Merged Dependabot pull requests, each frozen at its head commit.
VERIFIED_PRS=(98 97 96 94 93)
# A pull request a person opened, which must not verify.
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

echo "Merged Dependabot PRs, which must verify:"
for pr in "${VERIFIED_PRS[@]}"; do
  check_pr "${pr}" true
done

echo "A PR a person opened, which must not verify:"
check_pr "${REJECTED_PR}" false

exit "${failed}"
