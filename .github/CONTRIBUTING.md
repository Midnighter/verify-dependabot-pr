# Contributing

Thank you for your interest in contributing to `verify-dependabot-pr`. The
sections below cover everything you need to go from idea to merged pull request.

## Filing issues

Before opening a new issue, please search the existing ones to avoid duplicates.

When reporting a bug, include:

- The action version (`uses: Midnighter/verify-dependabot-pr@<version>`).
- The full step output and any error messages (redact secrets).
- The relevant workflow snippet.
- The repository visibility (public / private) and whether it is on GitHub.com
  or GitHub Enterprise Server.

For feature requests, describe the use case you are trying to address and how
the proposed change would help.

## Submitting pull requests

1. Fork the repository and create a branch from `main`.
2. Make your changes (see development setup below).
3. Add or update tests to cover the new behaviour.
4. Run the full check suite (`npm run all`) and ensure it passes.
5. Update `CHANGELOG.md` under the `[Unreleased]` section.
6. Open a pull request against `main` with a clear description of what changed
   and why.

Small, focused PRs are much easier to review than large, wide-ranging ones.
If you are planning a significant change, please open an issue first to discuss
the approach.

## Development setup

Node.js 24 or later is required. The shell script, workflow and workflow
security linters run through [uv](https://docs.astral.sh/uv/)'s `uvx`, which
fetches them on first use. Their versions are pinned in
`.github/tool-requirements.txt`, which each command passes to
`uvx --constraints`, so the version lives in one place and Dependabot's `pip`
ecosystem updates it. Edit that file to change a tool version.

```bash
# Install dependencies (clean install — matches CI exactly).
npm ci
```

The project uses [esbuild](https://esbuild.github.io/) to bundle the TypeScript
source and all dependencies into a single file at `dist/index.js`. `dist/` is
not committed to `main`; the release workflow builds it (see
[Releasing](#releasing)).

## Running the full check suite

```bash
# Lint, check formatting, type-check, test, and build in one command.
npm run all
```

Individual steps:

```bash
npm run lint            # ESLint
npm run lint:shell      # ShellCheck on scripts/
npm run lint:workflows  # actionlint (and ShellCheck on `run:` steps) on workflows
npm run lint:zizmor     # zizmor on the workflows and action.yml
npm run format:check    # Prettier (`npm run format` rewrites the files)
npm run typecheck       # TypeScript strict type checking (no emit)
npm run test            # Jest unit tests with coverage
npm run test:live       # the built action against this repo's real PRs
npm run test:merge-script # the merge script against stubbed gh and git
npm run build           # esbuild bundle → dist/
```

CI also runs `npm audit --omit=dev`, which fails on vulnerabilities of any
severity in the runtime dependencies that the action bundles, and
`npm audit --audit-level=high`, which fails on high or critical vulnerabilities
in any dependency.

`npm run lint:zizmor` runs offline unless a GitHub token is in the environment,
and says so in a warning. Offline it skips the audits that query GitHub, such as
whether an action's repository has been archived or has an advisory against it.
Set `GH_TOKEN` to run those too, as the Workflow Security job does. That job
runs on pull requests that touch the workflows, weekly on a schedule so the
upstream facts are rechecked even when nothing here changes, and on request
through **Actions → Workflow Security → Run workflow**.

[Amp](https://ampcode.com/) agents run the same checks before every commit
through the project plugin `.amp/plugins/pre-commit-checks.ts`. When a workflow
changed, the plugin also runs zizmor and `gh actions-lock --verify`, so it needs
the `gh actions-lock` extension (see [GitHub Actions](#github-actions)).

## Testing

Tests live under `tests/` and use [Jest](https://jestjs.io/) with `ts-jest`.
Fixture data (mock API responses) is stored under `__fixtures__/`. The `unit`
project tests `verifyPolicy` and the API client directly; the `acceptance`
project drives the whole action through Gherkin scenarios in
`tests/acceptance/features/`.

```bash
npm test
```

Coverage is collected automatically. Aim to keep branch coverage high for any
new code paths, particularly around error handling and edge cases in API
responses.

Both projects mock the GitHub API, so they confirm the policy matches our model
of GitHub rather than GitHub itself. `scripts/verify_live_prs.sh` closes that
gap: it runs the built `dist/index.js` against this repository's own pull
requests and checks the verdict, so it also covers input parsing and the step
outputs. Merged Dependabot pull requests are the anchors, because an open one
moves whenever Dependabot rebases it.

```bash
npm run build
GH_TOKEN=$(gh auth token) npm run test:live
```

The `live` job in `.github/workflows/checks.yml` runs it on every push and pull
request. Add an anchor when a rule starts depending on something no fixture
models, such as the shape of a real commit message.

### The merge script

`scripts/merge_dependabot_prs.sh` fast-forwards `main` onto Dependabot pull
requests you have already reviewed, so that Dependabot's own signed commits land
unchanged. It is a convenience for merging several at once, not a gate.

It deliberately does not check that the commits came from Dependabot. The action
does that on every pull request, and you do it when you read the diff. The
script once carried a copy of the action's rules in jq, and that copy twice lost
rules `src/policy.ts` had gained; keeping the two in step needs more machinery
than the convenience is worth. If this repository ever wants that check in the
merge path, the right answer is to use its own released action rather than to
re-implement it.

What the script does check is mechanical, and holds whether or not a pull
request was reviewed: that it is an open, same-repository Dependabot pull
request targeting `main`, and that it approves and pushes the exact commit whose
checks passed rather than wherever the branch has moved to since. That matters
because the push goes through the admin bypass, so `main`'s required status
checks do not gate it.

`scripts/verify_merge_script.sh` covers those decisions, running the script
against crafted pull requests with `gh` and `git` stubbed, so it needs no token
and can push nothing:

```bash
npm run test:merge-script
```

Add a case when you add a guard. The most valuable ones are those where the
script would push something other than the commit it checked.

## Code style

- **TypeScript strict mode** is enabled (`"strict": true` in `tsconfig.json`).
  All code must pass `tsc --noEmit` without errors.
- **ESLint** is configured via `eslint.config.mjs`. Run `npm run lint` before
  committing.
- **Prettier** formats all files, including the Gherkin `.feature` files, with
  the settings in `.prettierrc.json`. Run `npm run format` before committing.
- Use explicit types for function parameters and return values where the
  inference is not obvious.
- Prefer `const` over `let`; avoid `var`.
- Keep functions small and single-purpose.

## GitHub Actions

Workflow actions are referenced by version tag and locked to commit SHAs in
`.github/workflows/actions.lock`. After adding or changing a `uses:` line, run
[`gh actions-lock`](https://github.com/github/gh-actions-lock) (install it with
`gh extension install github/gh-actions-lock`) and commit the updated lockfile.
CI fails if the lockfile is out of date.

## Commit message format

Use the conventional commit style:

```
<type>(<scope>): <short summary>

<optional body>

<optional footer>
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.

Examples:

```
feat(inputs): add require-committer-login-match input
fix(api): handle null committer login in paginated commits
docs: update README with GHES example
```

The short summary line should be in the imperative mood, lowercase, and under
72 characters.

## Releasing

Push a version tag on `main`:

```bash
git tag 1.2.3
git push origin 1.2.3
```

The release workflow then runs the same checks CI runs, by calling
`.github/workflows/checks.yml`. Once they pass it checks that the tagged commit
is on `main`, builds `dist/`, attests the build provenance of `dist/index.js`,
commits `dist/` on top of the tagged commit, moves the tag to that commit, and
creates the GitHub Release. A tag on a commit that is not on `main` fails the
build. The release commit is reachable only through its tag, so `main` never
contains `dist/`. Afterwards, run `git fetch --tags --force` to update your
local tag.

The job that builds the bundle runs only `npm ci --ignore-scripts` and
`npm run build`. The linters and the test suite run in the `checks` job, which
produces no artifact, so a compromised development dependency cannot alter the
bundle that gets attested and released.

There is no major version tag such as `1`, because a tag that moves can point
consumers at new code without their workflow changing. Consumers reference a
release tag or its commit SHA.

To try a release first, push a pre-release tag such as `1.2.3-rc.1`. The
workflow then marks the GitHub Release as a pre-release.
