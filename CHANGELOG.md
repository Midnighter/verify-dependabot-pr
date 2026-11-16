# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
