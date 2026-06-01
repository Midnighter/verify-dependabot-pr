# Plan: `verify-dependabot-pr` — Standalone GitHub Action

A publish-ready GitHub Action that securely verifies a pull request is genuinely
authored by Dependabot before allowing it to be merged.

---

## 1. Product Definition

| Property | Value |
|---|---|
| **Goal** | Verify a PR is genuinely Dependabot-authored before merge |
| **Primary users** | Repos enforcing strict supply-chain / dependency-update controls |
| **MVP behaviour** | Fail the job unless PR author identity and commit metadata satisfy policy |
| **Default policy** | Strict and safe-by-default; configurable via inputs |
| **Threat boundary** | Verifies GitHub identity metadata only — not the safety of the dependency payload itself |

---

## 2. Action Form Factor

**Chosen form:** JavaScript Action (`node24`)

**Rationale:**
- Cross-platform (Linux, macOS, Windows runners) with no container overhead
- Clean Octokit-based API calls (no shell injection risk)
- Easy to unit-test with fixture data
- Straightforward Marketplace adoption

**Why not a reusable workflow:**
- Reusable workflows require `secrets: inherit` or explicit secret passing — unnecessary friction for consumers
- An Action can be called as a single step inside any existing job
- Portability: works in any workflow, not just ones that call a centralised workflow file

Also add a GHES example to the adoption UX section showing the `github-api-url` override.

---

## 3. Repository Structure

```
verify-dependabot-pr/                  # standalone public repo
├── action.yml                         # Action metadata, inputs, outputs, branding
├── package.json                       # dependencies, scripts, engines field
├── package-lock.json
├── tsconfig.json
├── eslint.config.mjs
├── .gitignore
├── LICENSE                            # Apache-2.0
├── README.md                          # usage, security model, examples, badge
├── CHANGELOG.md                       # Keep a Changelog format
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md                        # vulnerability disclosure process
├── CODEOWNERS                         # gate PRs to the Action repo itself
├── src/
│   ├── main.ts                        # entry point, wires inputs → policy → outputs
│   ├── github.ts                      # Octokit API wrapper (PR fetch, paginated commits)
│   ├── policy.ts                      # all verification rule functions
│   └── types.ts                       # typed payload interfaces
├── dist/
│   └── index.js                       # esbuild-bundled runtime — committed for Actions
├── __fixtures__/
│   ├── pr_dependabot.json             # happy-path PR API response
│   ├── pr_fork.json                   # fork PR (same login, different repo)
│   ├── pr_impersonator.json           # correct login, wrong account ID
│   ├── commits_verified.json          # all commits verified
│   ├── commits_unverified.json        # one commit unverified
│   ├── commits_null_author.json       # null author metadata
│   └── commits_paginated/             # multi-page commit fixture set
├── tests/
│   ├── policy.test.ts                 # unit tests for every policy rule
│   ├── github.test.ts                 # API client pagination + error handling
│   └── main.test.ts                   # integration: input wiring, output setting
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.yml
    │   └── feature_request.yml
    ├── PULL_REQUEST_TEMPLATE.md
    ├── dependabot.yml                 # keep Action's own dependencies up to date
    ├── release-drafter.yml            # automated changelog/release notes from PR labels
    └── workflows/
        ├── ci.yml                     # lint, typecheck, test, build, dist drift check
        ├── release.yml                # tag, rebuild dist, publish Release, update v1 tag
        └── scorecard.yml             # OpenSSF Scorecard analysis
```

---

## 4. Key Dependencies

| Package | Purpose |
|---|---|
| `@actions/core` | Set inputs, outputs, log levels, fail the step |
| `@actions/github` | Authenticated Octokit client, event context |
| `@octokit/plugin-retry` | Exponential backoff retries on transient GitHub API errors |
| `esbuild` | Bundle `src/` → single `dist/index.js` at build time |
| `typescript` | Type safety |
| `@types/node` | Node type definitions |
| `jest` + `ts-jest` | Unit testing |
| `eslint` + plugins | Linting |

---

## 5. Policy Contract

### Inputs

| Input | Default | Description |
|---|---|---|
| `github-token` | `${{ github.token }}` | Token for GitHub API calls |
| `pr-number` | `${{ github.event.pull_request.number }}` | PR to verify |
| `expected-login` | `dependabot[bot]` | Required PR author login |
| `expected-id` | `49699333` | Required PR author numeric account ID |
| `require-verified-commits` | `true` | Fail if any commit lacks a verified signature |
| `require-same-repo` | `true` | Fail if PR head is from a fork |
| `fail-on-missing-author-metadata` | `true` | Fail if commit author/committer login is null |
| `require-committer-login-match` | `false` | Require commit committer login to equal `expected-login` (see note on web-flow) |
| `allowed-committer-logins` | `web-flow` | Comma-separated logins accepted as valid committers alongside `expected-login` |
| `github-api-url` | `${{ github.api_url }}` | GitHub REST API base URL — override for GitHub Enterprise Server (e.g. `https://ghes.example.com/api/v3`) |

### Outputs

| Output | Description |
|---|---|
| `verified` | `true` or `false` |
| `reason` | Human-readable single-line failure reason (empty on success) |
| `checked-commit-count` | Number of commits that were inspected |

---

## 6. Verification Rules

Rules are evaluated in order; the first failure short-circuits with a clear message.

0. **Non-empty commit list** — PR must have at least one commit. A PR with zero commits
   is a hard failure regardless of other settings.
1. **PR author login** — must equal `expected-login`.
2. **PR author account ID** — must equal `expected-id` (prevents login-spoofing).
3. **Same-repo check** — `head.repo.full_name` must equal `base.repo.full_name` when
   `require-same-repo=true`.
4. **Commit author login** — every commit author login must equal `expected-login`.
5. **Commit committer login** — when `require-committer-login-match=true`, every commit
   committer login must equal `expected-login` **or** appear in `allowed-committer-logins`.
   Default is `false` because GitHub's web-flow bot (login `web-flow`, ID `19864447`) is
   the committer on all commits made via the GitHub API/UI, including Dependabot PRs.
6. **Null metadata guard** — null author or committer login treated as failure when
   `fail-on-missing-author-metadata=true`.
7. **Commit verification** — `commit.verification.verified` must be `true` for every commit
   when `require-verified-commits=true`.
8. **Pagination** — all commit pages fetched (not just the first 30) before passing.
   The GitHub REST API returns a maximum of 250 commits per PR. When
   `require-verified-commits=true` and the PR contains more than 250 commits, the action
   **fails hard** because it cannot guarantee all commits have been verified. This is
   extremely rare for Dependabot but prevents a bypass via commit-stuffing.

### Event trigger requirement

This action **must** run on `pull_request` (or `pull_request_target`) events. If `pr-number`
is empty (e.g. the workflow triggers on `push`), the action fails immediately with:
`"Error: pr-number is required — this action must run on pull_request events."`

---

## 7. Security Design

- Request minimum API permissions: `contents: read`, `pull-requests: read`.
- Never trust the login string alone — always cross-check numeric account ID.
- Use Octokit (no shell-out) to eliminate command injection risk.
- Treat null author/committer metadata as a policy failure by default.
- Emit deterministic log messages without exposing token values or response headers.
- Document threat boundary explicitly: this action verifies GitHub's identity metadata;
  it does not verify the safety of the dependency changes themselves.
- **Transient API failures:** all GitHub API calls must be retried with exponential
  backoff using `@octokit/plugin-retry` before treating a failure as terminal. The action
  always fails closed — a persistent API error is a hard failure, never a silent pass.
- **Octokit wiring:** use `@actions/github`'s `getOctokit()` plugin parameter to compose
  `@octokit/plugin-retry` into the client. This preserves the built-in auth strategy,
  user-agent, and proxy support:
  ```ts
  import { getOctokit } from '@actions/github'
  import { retry } from '@octokit/plugin-retry'

  const octokit = getOctokit(token, { baseUrl, retry: { retries: 3 } }, retry)
  ```
- **GitHub Enterprise Server (GHES):** the Octokit client must be initialised with the
  `baseUrl` derived from the `github-api-url` input (passed via the options object above),
  enabling full GHES compatibility without code changes.

### Permissions block for consuming workflows

```yaml
permissions:
  contents: read
  pull-requests: read
```

Include this in all usage examples in `README.md`.

---

## 8. `action.yml` Skeleton

```yaml
name: Verify Dependabot PR
description: >
  Securely verify that a pull request is genuinely authored by Dependabot
  by checking PR author identity, numeric account ID, and commit verification.
author: <your-handle>

branding:
  icon: shield
  color: blue

inputs:
  github-token:
    description: GitHub token for API access.
    default: ${{ github.token }}
    required: false
  pr-number:
    description: PR number to verify.
    default: ${{ github.event.pull_request.number }}
    required: false
  expected-login:
    description: Expected PR author login.
    default: dependabot[bot]
    required: false
  expected-id:
    description: Expected PR author numeric account ID.
    default: "49699333"
    required: false
  require-verified-commits:
    description: Fail if any commit lacks a verified signature.
    default: "true"
    required: false
  require-same-repo:
    description: Fail if the PR head is from a fork.
    default: "true"
    required: false
  fail-on-missing-author-metadata:
    description: Fail if commit author/committer login metadata is null.
    default: "true"
    required: false
  require-committer-login-match:
    description: >
      Require commit committer login to equal expected-login or appear in
      allowed-committer-logins. Default false because GitHub's web-flow bot
      is the committer on Dependabot PRs.
    default: "false"
    required: false
  allowed-committer-logins:
    description: >
      Comma-separated logins accepted as valid committers alongside
      expected-login (only relevant when require-committer-login-match is true).
    default: "web-flow"
    required: false
  github-api-url:
    description: >
      GitHub REST API base URL. Override for GitHub Enterprise Server,
      e.g. https://ghes.example.com/api/v3. Defaults to github.api_url.
    default: ${{ github.api_url }}
    required: false

outputs:
  verified:
    description: "true if all checks passed, false otherwise."
  reason:
    description: Human-readable failure reason (empty on success).
  checked-commit-count:
    description: Number of commits inspected.

runs:
  using: node24
  main: dist/index.js
```

---

## 9. Testing Strategy

### Unit tests (jest + fixtures)

| Test scenario | Expected result |
|---|---|
| Happy path — all rules satisfied | `verified=true`, no reason |
| Wrong login (correct ID) | fail: wrong login |
| Correct login, wrong ID | fail: wrong ID |
| Fork PR (`require-same-repo=true`) | fail: fork not allowed |
| Fork PR (`require-same-repo=false`) | pass |
| Unverified commit | fail: unverified commit |
| Null author metadata (`fail-on-missing-author-metadata=true`) | fail: null metadata |
| Null author metadata (`fail-on-missing-author-metadata=false`) | pass |
| Committer is `web-flow` (`require-committer-login-match=true`) | pass (in allowed list) |
| Committer is unknown login (`require-committer-login-match=true`) | fail: unexpected committer |
| Committer is `web-flow` (`require-committer-login-match=false`) | pass (check skipped) |
| Multi-page commit list (pagination) | all pages checked |
| API 500 error (after retries exhausted) | hard fail with API error message |
| PR with 0 commits | fail: no commits found |
| Missing `pr-number` (non-PR event trigger) | fail: pr-number is required |

### CI checks (`.github/workflows/ci.yml`)

- ESLint
- TypeScript type check
- Jest tests (100% pass required)
- **100% code coverage gate** — Jest configured with `coverageThreshold` for
  `{ global: { branches: 100, functions: 100, lines: 100, statements: 100 } }`.
  The CI step runs `jest --coverage` and fails if any threshold is not met.
- `esbuild` bundle
- **`dist/` drift check:** rebuild and assert no uncommitted diff (prevents sneaked changes)
- `actionlint` on all workflow files

### Local testing

Use [`nektos/act`](https://github.com/nektos/act) to run the Action locally against
fixture event payloads before pushing:

```bash
act pull_request -e __fixtures__/event_dependabot_pr.json
```

> **Note:** `act` support for the `node24` runtime may lag behind GitHub's hosted runners.
> If `act` does not yet support `node24`, test locally by running `node dist/index.js`
> directly with the appropriate `INPUT_*` environment variables set, or wait for an `act`
> release that includes `node24` support.

### Node.js version matrix in CI

Test on all active Node LTS versions starting from Node 24 to catch compatibility
regressions early. Update the matrix whenever a new LTS line enters Active LTS status.

---

## 10. Release Pipeline (`.github/workflows/release.yml`)

1. Triggered on `push` to `main` or manual `workflow_dispatch`.
2. Install dependencies.
3. Run full CI suite (lint + test).
4. Bundle with `esbuild` → `dist/index.js`.
5. Assert zero `dist/` drift.
6. Commit `dist/` to the release branch if changed.
7. Create a GitHub Release (semver tag e.g. `v1.2.0`) with auto-generated notes from
   Release Drafter.
8. Update the moving major tag:
   ```bash
   git tag -f v1
   git push -f origin v1
   ```
9. Optionally use `actions/publish-action` to update the Marketplace listing.

### Versioning policy

- **SemVer** (`MAJOR.MINOR.PATCH`)
- Breaking input/output changes bump `MAJOR`.
- New inputs with safe defaults bump `MINOR`.
- Bug fixes bump `PATCH`.
- Consumers should pin to `vMAJOR` (e.g. `uses: you/verify-dependabot-pr@v1`).
- **Backward compatibility guarantee** within a major version.

---

## 11. Supply-Chain Hardening for the Action Itself

- Enable **OpenSSF Scorecard** via `.github/workflows/scorecard.yml` and publish the
  badge in `README.md`.
- Publish **SLSA provenance** for releases using
  [`slsa-framework/slsa-github-generator`](https://github.com/slsa-framework/slsa-github-generator).
- Pin all third-party Actions in CI workflows to a full SHA (not a tag), with a comment
  noting the tag equivalent:
  ```yaml
  uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
  ```
- Enable **Dependabot** for the Action repo (`npm` ecosystem + `github-actions`
  ecosystem).

---

## 12. Marketplace Metadata Requirements

For the GitHub Marketplace listing to be approved:

- Repository must be **public**.
- `action.yml` must be present at the repository root.
- `name` in `action.yml` must be unique in the Marketplace.
- `README.md` must be present.
- A valid OSS `LICENSE` file must be present.
- `branding.icon` must be a valid Feather icon name.
- `branding.color` must be one of the allowed Marketplace colours.

---

## 13. Adoption UX

### Minimal usage snippet (for `README.md`)

```yaml
name: Dependabot PR Policy

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: read

jobs:
  verify-dependabot:
    runs-on: ubuntu-latest
    # Only run this job for Dependabot PRs
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    steps:
      - name: Verify Dependabot PR authenticity
        uses: <owner>/verify-dependabot-pr@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Configuring as a required status check

1. In **Settings → Branches → Branch protection rules**, add a rule for `main`.
2. Enable **Require status checks to pass before merging**.
3. Search for and add `verify-dependabot` (the job name above).

### Relaxed mode (allow forks)

```yaml
- uses: <owner>/verify-dependabot-pr@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    require-same-repo: "false"
```

### GitHub Enterprise Server (GHES)

```yaml
- uses: <owner>/verify-dependabot-pr@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    github-api-url: https://ghes.example.com/api/v3
```

The `github-api-url` input defaults to `${{ github.api_url }}`, which is automatically
set to the correct value on both github.com and GHES — so in most cases no override is
needed. Supply it explicitly only when the Action is called from a context where
`github.api_url` resolves to a different host than the target repository.

### `timeout-minutes` recommendation

Always set a timeout on the consuming job to prevent indefinite hangs on API issues:

```yaml
jobs:
  verify-dependabot:
    runs-on: ubuntu-latest
    timeout-minutes: 5
```

---

## 14. Documentation Outline (`README.md`)

1. **Badge row** — CI status, Marketplace version, OpenSSF Scorecard, SLSA level
2. **One-liner description**
3. **Security boundary disclaimer** — verifies identity metadata, not dependency safety
4. **Quickstart** — copy-paste minimal snippet
5. **Inputs reference table**
6. **Outputs reference table**
7. **Advanced examples** — relaxed mode, output consumption, custom expected-login
8. **Required permissions** — `contents: read`, `pull-requests: read`
9. **Branch protection setup** — required status check guide
10. **Threat model** — what this action does and does not protect against
11. **Troubleshooting** — common failure reasons and how to resolve them
12. **Contributing** — link to `CONTRIBUTING.md`
13. **License**

---

## 15. Maintenance Plan

| Activity | Cadence |
|---|---|
| Dependabot npm updates | Weekly (auto PR) |
| Dependabot Actions updates | Weekly (auto PR) |
| OpenSSF Scorecard review | Monthly |
| Changelog update | Every release |
| Node.js version review | At each new LTS release |
| Backward compat audit before MAJOR | Per major release |
| Security disclosures | Via `SECURITY.md` process |

---

## Open Questions / Decisions Before Implementation

- [ ] Choose repository owner / organisation
- [x] ~~Confirm `node24` availability as `runs.using` value~~ — **Confirmed: target `node24`.**

---

## 16. Future Enhancements (Out of MVP Scope)

- **GitHub App ID check** — optionally verify the PR was created by an app installation
  with a specific `app.id` (Dependabot's app slug is `dependabot`). This would provide
  an additional identity signal beyond the bot account login/ID.
- **`author_association` check** — optionally require the PR author's association to be
  a known value (e.g., `BOT` or `MEMBER`).

