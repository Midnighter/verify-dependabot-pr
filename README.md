# Verify Dependabot PR

[![CI](https://github.com/Midnighter/verify-dependabot-pr/actions/workflows/ci.yml/badge.svg)](https://github.com/Midnighter/verify-dependabot-pr/actions/workflows/ci.yml)

Securely verify that a pull request is genuinely authored by Dependabot before allowing it to be merged.

## Security boundary disclaimer

This action verifies that a PR was opened by the official Dependabot bot account
(by login name, account type **and** numeric account ID), that every commit on it
is a commit GitHub verified with Dependabot as its author, and that the result
applies to the head commit the workflow ran for. It is a defence-in-depth
control, not a cryptographic proof of supply chain integrity. An attacker who
has already compromised GitHub's infrastructure or the Dependabot service itself
is outside the threat model. Always review Dependabot PRs for unexpected
dependency changes regardless of this action's result.

## Quickstart

This Action is intended to be used for auto-merging Dependabot pull requests.
For the below workflow to succeed, you must [enable
auto-merging](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request#enabling-auto-merge)
on your repository. Additionally, you need to [allow GitHub Actions to create
and approve pull
requests](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests).
Very likely, you will also want to enable branch protection rules and [require
status
checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
to pass before merging.

Add the following workflow. On `pull_request` events the action takes the PR
number and head commit from the event and uses the built-in `GITHUB_TOKEN`, so
it needs no inputs. The `merge` job approves and merges only the head commit
that the action verified.

Reference the action by a release tag or, better, by the commit SHA that the tag
points to. `main` does not contain the built action.

```yaml
name: Auto-Merge Dependabot PR

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

permissions: {}

jobs:
  verify:
    permissions:
      contents: read
      pull-requests: read
    runs-on: ubuntu-slim
    timeout-minutes: 5
    # Only run for Dependabot PRs — avoids wasting API quota on human PRs.
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    outputs:
      head-sha: ${{ steps.verify.outputs.head-sha }}
    steps:
      - name: Verify Dependabot PR
        id: verify
        uses: Midnighter/verify-dependabot-pr@0.3.0

  merge:
    permissions:
      contents: write
      pull-requests: write
    runs-on: ubuntu-slim
    timeout-minutes: 5
    needs: [verify]
    steps:
      - name: Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@25dd0e34f4fe68f24cc83900b1fe3fe149efef98 # v3.1.0
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Enable auto-merge for Dependabot PRs
        if: |
          steps.metadata.outputs.update-type == 'version-update:semver-patch' ||
          steps.metadata.outputs.update-type == 'version-update:semver-minor'
        # Fails if the PR head is no longer the verified commit.
        run: gh pr merge --auto --merge --match-head-commit "$HEAD_SHA" "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          HEAD_SHA: ${{ needs.verify.outputs.head-sha }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Approve PR
        if: |
          steps.metadata.outputs.update-type == 'version-update:semver-patch' ||
          steps.metadata.outputs.update-type == 'version-update:semver-minor'
        # Approves the verified commit, not whatever the head is by now.
        run: |
          gh api --method POST "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/reviews" \
            -f commit_id="$HEAD_SHA" -f event=APPROVE --silent
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
          HEAD_SHA: ${{ needs.verify.outputs.head-sha }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Make the `verify` job a required status check (see
[Branch protection setup](#branch-protection-setup)). A push after auto-merge
was enabled then starts a new run, and the PR merges only if that run passes.

## Inputs

| Input          | Required | Default                                     | Description                                                                                                                                                            |
| -------------- | -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token` | No       | `${{ github.token }}`                       | GitHub token used for REST API calls.                                                                                                                                  |
| `pr-number`    | No       | `${{ github.event.pull_request.number }}`   | Number of the pull request to verify.                                                                                                                                  |
| `head-sha`     | No       | `${{ github.event.pull_request.head.sha }}` | Head commit SHA the workflow ran for. The action fails if the PR's head is a different commit.                                                                         |
| `expected-id`  | No       | `49699333`                                  | Dependabot's numeric account ID. Set it only on GitHub Enterprise Server, where the Dependabot account has its own ID. On GitHub.com any other value fails the action. |

On `pull_request` and `pull_request_target` events the defaults are right. On
other events, such as `workflow_dispatch`, pass `pr-number` and `head-sha`
together.

Every check is always on. Version 0.3.0 removed the inputs that turned checks
off or changed what they compare against; see the [changelog](CHANGELOG.md). A
workflow that still passes one gets a warning from the runner, and the action
ignores it.

## Outputs

| Output                 | Description                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `verified`             | `"true"` if all checks passed; `"false"` otherwise, including when the action stops on an error.               |
| `reason`               | Human-readable failure reason. Empty string on success.                                                        |
| `checked-commit-count` | Number of commits inspected across all pages.                                                                  |
| `head-sha`             | The head commit SHA that was verified. Empty unless `verified` is `"true"`. Approve or merge only this commit. |

## Advanced examples

### GitHub Enterprise Server (GHES)

The action calls the API of the GitHub instance its runner belongs to, so it
needs no URL. The Dependabot account has its own ID on each GHES instance. Look
it up:

```bash
gh api --hostname ghes.example.com 'users/dependabot[bot]' --jq .id
```

and pass it as `expected-id`:

```yaml
- name: Verify Dependabot PR
  id: verify
  uses: Midnighter/verify-dependabot-pr@0.3.0
  with:
    expected-id: "1234" # Dependabot's account ID on your instance.
```

### Using outputs in subsequent steps

Let later steps decide what to do instead of failing the job. Pass the outputs
to scripts through `env:` rather than writing `${{ }}` inside `run:`, so that
their content cannot run as shell code.

```yaml
- name: Verify Dependabot PR
  id: verify
  # Later steps still run; verified is "false" on any failure.
  continue-on-error: true
  uses: Midnighter/verify-dependabot-pr@0.3.0

- name: Report verification result
  run: |
    echo "Verified: ${VERIFIED}"
    echo "Commits checked: ${COMMIT_COUNT}"
    echo "Reason: ${REASON}"
  env:
    VERIFIED: ${{ steps.verify.outputs.verified }}
    COMMIT_COUNT: ${{ steps.verify.outputs.checked-commit-count }}
    REASON: ${{ steps.verify.outputs.reason }}

- name: Approve the verified commit
  if: steps.verify.outputs.verified == 'true'
  run: |
    gh api --method POST "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/reviews" \
      -f commit_id="$HEAD_SHA" -f event=APPROVE --silent
  env:
    PR_NUMBER: ${{ github.event.pull_request.number }}
    HEAD_SHA: ${{ steps.verify.outputs.head-sha }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Verifying a release

Each release attests that its `dist/index.js` was built by this repository's
release workflow from a commit on `main`. Download the file at the release tag
and verify it:

```bash
curl -fsSLO https://raw.githubusercontent.com/Midnighter/verify-dependabot-pr/0.3.0/dist/index.js
gh attestation verify index.js --repo Midnighter/verify-dependabot-pr \
  --signer-workflow Midnighter/verify-dependabot-pr/.github/workflows/release.yml
```

## Required permissions

The following permissions must be granted to the workflow job. No write
permissions are required.

```yaml
permissions:
  contents: read # Read commits on the PR head branch.
  pull-requests: read # Read PR author metadata.
```

If your repository or organisation enforces a restrictive default permissions
policy, add these lines explicitly to the job or workflow that calls this action.

## Branch protection setup

To make this action a mandatory gate before merging, add it as a required status
check in your branch protection rules:

1. Go to **Settings → Branches** in your repository.
2. Edit the branch protection rule for your default branch (usually `main`).
3. Enable **Require status checks to pass before merging**.
4. Search for and select the job name that runs this action (e.g. `verify`).
5. Optionally enable **Restrict who can push to matching branches** and add only
   the Dependabot app so that only verified Dependabot PRs can land.

For organisations using GitHub's Ruleset feature, create a **branch ruleset**
and add the job as a required workflow under **Require workflows to pass**.

## Threat model

This action is designed to prevent the following attack scenarios:

| Scenario                                                                                                    | Mitigated? | How                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A person or another bot opens a PR under a name that looks like Dependabot's                                | Yes        | The PR author must be `dependabot[bot]`, of type `Bot`, with Dependabot's account ID.                                                                                          |
| Attacker creates a bot account named `dependabot`                                                           | Yes        | Numeric account ID check; GitHub also reserves `[bot]` suffix accounts.                                                                                                        |
| Someone with push access adds or amends a commit on Dependabot's branch that names Dependabot as its author | Yes        | A commit counts only if GitHub verified its signature and its committer is `web-flow` or Dependabot. A commit signed with a person's own key has that person as its committer. |
| Commit pushed without a signature                                                                           | Yes        | Every commit must have a signature that GitHub verified.                                                                                                                       |
| Commit whose author or committer has no GitHub account                                                      | Yes        | Commits with a null author or committer are rejected.                                                                                                                          |
| PR from a fork                                                                                              | Yes        | Head and base must be the same repository, compared by ID.                                                                                                                     |
| A commit is pushed while the workflow runs                                                                  | Yes        | The PR head must be the `head-sha` the workflow ran for and the last listed commit. Approve and merge only the `head-sha` output.                                              |
| Pagination bypass — malicious commit on page 2+                                                             | Yes        | All commit pages are fetched, and their count must equal the PR's commit count.                                                                                                |
| The token is sent to another host                                                                           | Yes        | The API URL is always the runner's own `GITHUB_API_URL`.                                                                                                                       |
| Transient API failure causes a false pass                                                                   | Yes        | Exponential backoff retry; failures set `verified` to `false` and fail the step.                                                                                               |

This action does **not** protect against:

- A compromised Dependabot service issuing PRs with malicious dependency updates.
- A repository admin who grants write access to an untrusted actor.
- A commit pushed after auto-merge was enabled, unless the job that runs this
  action is a required status check, so that the run the push starts must pass
  too.
- Attacks that occur after a PR has been merged.

## Troubleshooting

### `verified` is `false` but the PR looks legitimate

Check the `reason` output for the specific failure. Common causes:

- _A commit is not verified, or its committer is neither web-flow nor
  Dependabot_ — Someone rebased, amended or pushed to Dependabot's branch, so
  the commit is no longer Dependabot's. Comment `@dependabot recreate` on the PR
  to have Dependabot rebuild it.
- _The PR head is not the head commit that the workflow ran for_ — The PR
  changed while the workflow ran. The push that changed it starts a new run,
  which verifies the new head.
- _Author ID mismatch_ — On GitHub.com, remove `expected-id`. On GHES, set it to
  your instance's Dependabot account ID (see
  [GitHub Enterprise Server](#github-enterprise-server-ghes)).

### The action fails with `pr-number is required` or `head-sha is required`

The workflow does not run on a `pull_request` event. Pass `pr-number` and
`head-sha` yourself.

### The action fails with an API rate-limit error

Pass a token with higher rate limits via the `github-token` input, or ensure
the workflow does not run too frequently.

### The action fails on GitHub Enterprise Server

The action calls the API of the instance its runner belongs to. Set
`expected-id` to that instance's Dependabot account ID, and make sure the token
can read the repository's pull requests and commits.

### `checked-commit-count` is `0`

The API listed no commits for the PR, and `reason` says `PR has no commits.`
This happens when the PR's branch adds nothing to its base branch. A wrong
`pr-number` that points to no PR fails with an API error instead.

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for development setup, coding standards,
and the pull request process.

## License

[Apache-2.0](LICENSE)
