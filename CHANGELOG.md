# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- A commit whose committer claims the login `web-flow` must also have that
  account's ID: 19864447 on GitHub.com, and on GitHub Enterprise Server the ID
  of the instance's own `web-flow` account, given in the new
  `expected-web-flow-id` input. A login alone is not evidence, because GitHub
  resolves it from the email addresses written into the commit.
- Which instance the action runs on is read from the runner's
  `GITHUB_SERVER_URL`, which workflows cannot change, rather than inferred from
  the value of `expected-id`. A GHES instance whose Dependabot account happens
  to hold GitHub.com's account ID is no longer mistaken for GitHub.com, which
  had made it reject its own genuine Dependabot pull requests.
- A commit counts as verified only when `verification.verified` is exactly
  `true`, not merely a value that looks true.

### Changed

- `pr-number` and `expected-id` must be whole numbers. Before, values such as
  `12abc`, `42.9` and `1e3` were read as `12`, `42` and `1`, so the action
  could check a different pull request than the workflow named.
- The checks live in one reusable workflow, `.github/workflows/checks.yml`,
  which both CI and the release workflow call. The job that builds the released
  bundle now runs only `npm ci --ignore-scripts` and `npm run build`, so no
  linter or test dependency runs in the job that produces the attested
  artifact. The bundle itself is unchanged: building `993497a` without the
  lint and test steps reproduces the published 0.3.0 bundle byte for byte.
- The versions of ShellCheck, actionlint and zizmor live in
  `.github/tool-requirements.txt`, which every command passes to
  `uvx --constraints`. Dependabot's `pip` ecosystem updates that file, so these
  tools no longer need a hand-edited version string. `gh-actions-lock` is
  pinned with `--pin v0.4.1` in the workflow, because it is not a Python or npm
  package and Dependabot has no ecosystem for `gh` extensions; it still needs a
  human to raise it.
- The workflow security job runs the zizmor CLI instead of
  `zizmorcore/zizmor-action`, so zizmor's version comes from the requirements
  file. `--format=github` reports the same annotations, and zizmor's non-zero
  exit still fails the job. Dropping the action also drops its transitive
  dependency on `github/codeql-action`, which it used for the SARIF upload this
  repository declines. The audit now covers `action.yml` as well as the
  workflows, through a new `lint:zizmor` script.
- The zizmor audit also runs weekly, and on request through
  `workflow_dispatch`. Several of its audits report on facts that live upstream
  rather than in this repository, such as an action's repository being
  archived, an advisory published against an action, or a tag that has moved
  off the commit it named; none of those change this repository, so no pull
  request brings them to light. The job now passes `GH_TOKEN`, because without
  a token zizmor runs offline and skips every online audit with only a warning.
  It also runs on every pull request rather than only those touching the
  workflows: it is a required status check on `main`, and a workflow skipped by
  a `paths` filter leaves its check pending rather than passing, which would
  block every pull request the filter did not match.
- A `live` job in the checks workflow runs the built action against this
  repository's own pull requests, through `scripts/verify_live_prs.sh`. The unit
  and acceptance suites mock the GitHub API, so they confirm the policy matches
  our model of GitHub rather than GitHub itself, and cannot catch a rule
  tightened until it rejects genuine Dependabot pull requests. Because it runs
  `dist/index.js`, it also covers input parsing and the step outputs.
- The maintainer script `scripts/merge_dependabot_prs.sh` no longer carries a
  copy of the action's commit rules. It fast-forwards `main` onto Dependabot
  pull requests that have already been reviewed, and the action itself checks
  every pull request, so the copy added nothing that was relied on while
  drifting from `src/policy.ts` twice. What the script still checks is
  mechanical: that the pull request is an open, same-repository Dependabot pull
  request targeting `main`, and that it approves and pushes the exact commit
  whose checks passed. `scripts/verify_merge_script.sh` covers those decisions
  with `gh` and `git` stubbed, and runs in CI.

### Removed

- `DEPENDABOT_ACTION_PLAN.md`. It described the design before 0.3.0 and still
  recommended a moving `@v1` tag, the `github-api-url` input and
  `require-same-repo: false`, all of which 0.3.0 removed. `README.md` documents
  the inputs, outputs and threat model, and `.github/CONTRIBUTING.md` the
  release process.
- `.github/release-drafter.yml`. No workflow used it, and its `v`-prefixed tag
  template contradicted the release workflow's tag patterns.
- The `version` field in `package.json`, which said `1.0.0` while the latest
  release was `0.3.0`. Nothing reads it: the action is distributed by git tag,
  not published to npm, so the field was a second source of truth that could
  only drift. The package is now marked `private`.

## [0.3.0] - 2026-11-16

### Security

- Every commit's committer must be `web-flow` or Dependabot, and its author
  must have Dependabot's account ID as well as its login. Before, someone with
  push access could add a commit to Dependabot's branch that named Dependabot as
  its author, sign it with their own key, and pass with the default inputs.
- The result applies only to the PR head commit the workflow ran for, and the
  new `head-sha` output names that commit. Before, a commit pushed while the
  workflow ran could be approved and merged without being checked.
- The action fails when the API lists fewer commits than the PR has, instead of
  passing after checking only some of them.

### Added

- Releases attest the build provenance of `dist/index.js`. Check it with
  `gh attestation verify index.js --repo Midnighter/verify-dependabot-pr`.
- The `head-sha` input, which defaults to the head commit of the triggering
  `pull_request` event, and the `head-sha` output, the verified commit.

### Removed

- The inputs `expected-login`, `require-verified-commits`, `require-same-repo`,
  `fail-on-missing-author-metadata`, `require-committer-login-match`,
  `allowed-committer-logins` and `github-api-url`. Their checks are always on,
  the login is always `dependabot[bot]`, and the API URL is always the runner's
  `GITHUB_API_URL`. A workflow that still passes one gets a warning from the
  runner, and the action ignores it.
- The major version tag `0`. Releases no longer create or move a major version
  tag, because a tag that moves can point consumers at new code without their
  workflow changing. Reference a release tag such as `0.3.0` or its commit SHA.

### Changed

- When the action stops on an error, `verified` is `false` and `reason` holds
  the error. Before, both were unset.
- The PR author must be of type `Bot`.
- Head and base repositories are compared by ID instead of by name.
- On GitHub.com, `expected-id` must be `49699333`.
- The bundled `dist/` is no longer committed to `main`; the release workflow
  builds it and tags a release commit that contains it. Reference the action by
  a release tag or SHA, not by `main`.

## [0.1.0] - 2026-06-05

### Added

- Initial release.
