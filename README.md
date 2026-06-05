# Verify Dependabot PR

[![CI](https://github.com/Midnighter/verify-dependabot-pr/actions/workflows/ci.yml/badge.svg)](https://github.com/Midnighter/verify-dependabot-pr/actions/workflows/ci.yml)

Securely verify that a pull request is genuinely authored by Dependabot before allowing it to be merged.

## Security boundary disclaimer

This action verifies that a PR was opened by the official Dependabot bot account
(by login name **and** numeric account ID) and that its commits carry valid GitHub
signatures. It is a defence-in-depth control, not a cryptographic proof of supply
chain integrity. An attacker who has already compromised GitHub's infrastructure
or the Dependabot service itself is outside the threat model. Always review
Dependabot PRs for unexpected dependency changes regardless of this action's
result.

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

Add the following step to a workflow that runs on `pull_request` events. The
action uses the built-in `GITHUB_TOKEN` and the current PR number by default, so
no extra configuration is required for the common case.

```yaml
name: Auto-Merge Dependabot PR

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    permissions:
      contents: read
      pull-requests: read
    runs-on: ubuntu-slim
    # Only run for Dependabot PRs — avoids wasting API quota on human PRs.
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Verify Dependabot PR
        id: verify
        uses: Midnighter/verify-dependabot-pr@4cba4d52b24bed45b73b95d92297594694e21ac8 # v0.2.0

  merge:
    permissions:
      contents: write
      pull-requests: write
    runs-on: ubuntu-slim
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
        run: gh pr merge --auto --merge "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Approve PR
        if: |
          steps.metadata.outputs.update-type == 'version-update:semver-patch' ||
          steps.metadata.outputs.update-type == 'version-update:semver-minor'
        run: gh pr review --approve "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input                             | Required | Default                                   | Description                                                                                                                                                                                                                           |
| --------------------------------- | -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`                    | No       | `${{ github.token }}`                     | GitHub token used for REST API calls.                                                                                                                                                                                                 |
| `pr-number`                       | No       | `${{ github.event.pull_request.number }}` | Number of the pull request to verify.                                                                                                                                                                                                 |
| `expected-login`                  | No       | `dependabot[bot]`                         | Expected PR author login. Override when using a self-hosted Dependabot instance.                                                                                                                                                      |
| `expected-id`                     | No       | `49699333`                                | Expected PR author numeric account ID. This ID is stable and cannot be reassigned, making it a stronger identity check than the login alone.                                                                                          |
| `require-verified-commits`        | No       | `true`                                    | Fail if any commit in the PR lacks a verified GPG/SSH signature.                                                                                                                                                                      |
| `require-same-repo`               | No       | `true`                                    | Fail if the PR head branch originates from a fork rather than the base repository. Set to `false` for organisations that allow Dependabot to open PRs from forks.                                                                     |
| `fail-on-missing-author-metadata` | No       | `true`                                    | Fail if any commit is missing author or committer login metadata. This can indicate that a commit was pushed by a deleted account or via the API without identity context.                                                            |
| `require-committer-login-match`   | No       | `false`                                   | Require every commit's committer login to equal `expected-login` or appear in `allowed-committer-logins`. Defaults to `false` because GitHub's `web-flow` bot is the recorded committer on Dependabot commits, not Dependabot itself. |
| `allowed-committer-logins`        | No       | `web-flow`                                | Comma-separated list of logins accepted as valid committers in addition to `expected-login`. Only evaluated when `require-committer-login-match` is `true`.                                                                           |
| `github-api-url`                  | No       | `${{ github.api_url }}`                   | GitHub REST API base URL. Override this for GitHub Enterprise Server (GHES) deployments, e.g. `https://ghes.example.com/api/v3`.                                                                                                      |

## Outputs

| Output                 | Description                                             |
| ---------------------- | ------------------------------------------------------- |
| `verified`             | `"true"` if all checks passed; `"false"` otherwise.     |
| `reason`               | Human-readable failure reason. Empty string on success. |
| `checked-commit-count` | Number of commits inspected across all pages.           |

## Advanced examples

### Relaxed mode — allow fork PRs

Some organisations configure Dependabot to open PRs from a fork of the target
repository. Disable the same-repo check in that case:

```yaml
- name: Verify Dependabot PR
  id: verify
  uses: Midnighter/verify-dependabot-pr@v1
  with:
    require-same-repo: "false"
```

### GitHub Enterprise Server (GHES)

Override the API base URL to point at your GHES instance. The token must have
the same scopes as on GitHub.com.

```yaml
- name: Verify Dependabot PR
  id: verify
  uses: Midnighter/verify-dependabot-pr@v1
  with:
    github-api-url: https://ghes.example.com/api/v3
    github-token: ${{ secrets.GHES_TOKEN }}
```

### Using outputs in subsequent steps

Capture the action's outputs to make downstream decisions without failing the
workflow immediately:

```yaml
- name: Verify Dependabot PR
  id: verify
  uses: Midnighter/verify-dependabot-pr@v1

- name: Report verification result
  run: |
    echo "Verified: ${{ steps.verify.outputs.verified }}"
    echo "Commits checked: ${{ steps.verify.outputs.checked-commit-count }}"
    echo "Reason: ${{ steps.verify.outputs.reason }}"

- name: Auto-approve if verified
  if: steps.verify.outputs.verified == 'true'
  uses: hmarr/auto-approve-action@v4
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Strict mode — enforce committer identity

Enable committer login matching and restrict to a custom set of allowed bots:

```yaml
- name: Verify Dependabot PR
  id: verify
  uses: Midnighter/verify-dependabot-pr@v1
  with:
    require-committer-login-match: "true"
    allowed-committer-logins: "web-flow,my-org-bot"
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

| Scenario                                                  | Mitigated? | How                                                                          |
| --------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Human pushes a PR pretending to be Dependabot by username | Yes        | Numeric account ID (`expected-id`) cannot be spoofed by a different account. |
| Attacker creates a bot account named `dependabot`         | Yes        | Numeric account ID check; GitHub also reserves `[bot]` suffix accounts.      |
| Fork PR with a rewritten author field                     | Yes        | `require-same-repo` blocks PRs from forks by default.                        |
| Commit pushed without a GitHub-issued signature           | Yes        | `require-verified-commits` rejects unsigned or self-signed commits.          |
| Deleted or anonymous committer in commit metadata         | Yes        | `fail-on-missing-author-metadata` rejects commits with null login fields.    |
| Pagination bypass — malicious commit on page 2+           | Yes        | All commit pages are fetched and checked.                                    |
| Transient API failure causes a false pass                 | Yes        | Exponential backoff retry; failures surface as errors, not silent passes.    |

This action does **not** protect against:

- A compromised Dependabot service issuing PRs with malicious dependency updates.
- A repository admin who grants write access to an untrusted actor.
- Attacks that occur after a PR has been merged.

## Troubleshooting

### `verified` is `false` but the PR looks legitimate

Check the `reason` output for the specific failure. Common causes:

- _Commit signature verification failed_ — The commit was rebased or amended
  outside of Dependabot, breaking the signature. Close and let Dependabot
  reopen the PR.
- _PR head is from a fork_ — Your repository has `require-same-repo: true`
  (default) but Dependabot is configured to open from a fork. Set
  `require-same-repo: "false"` or reconfigure Dependabot.
- _Author ID mismatch_ — The `expected-id` input was overridden and does not
  match the actual Dependabot account ID (`49699333`). Restore the default or
  use the correct ID for your GHES instance.

### The action fails with an API rate-limit error

Pass a token with higher rate limits via the `github-token` input, or ensure
the workflow does not run too frequently.

### The action fails on GitHub Enterprise Server

Set `github-api-url` to your GHES REST API base URL
(`https://<hostname>/api/v3`). Ensure the token has `repo` scope on the GHES
instance.

### `checked-commit-count` is `0`

The PR has no commits (e.g. the PR number is incorrect or the PR is a draft
with no pushes). Verify that `pr-number` resolves to a valid, non-empty PR.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards,
and the pull request process.

## License

[Apache-2.0](LICENSE)
