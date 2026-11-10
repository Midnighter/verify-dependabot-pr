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

Node.js 24 or later is required.

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
# Lint, type-check, test, and build in one command.
npm run all
```

Individual steps:

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript strict type checking (no emit)
npm run test       # Jest unit tests with coverage
npm run build      # esbuild bundle → dist/
```

## Testing

Tests live alongside the source in `src/` and use [Jest](https://jestjs.io/)
with `ts-jest`. Fixture data (mock API responses) is stored under
`__fixtures__/`.

```bash
npm test
```

Coverage is collected automatically. Aim to keep branch coverage high for any
new code paths, particularly around error handling and edge cases in API
responses.

## Code style

- **TypeScript strict mode** is enabled (`"strict": true` in `tsconfig.json`).
  All code must pass `tsc --noEmit` without errors.
- **ESLint** is configured via `eslint.config.mjs`. Run `npm run lint` before
  committing.
- Use explicit types for function parameters and return values where the
  inference is not obvious.
- Prefer `const` over `let`; avoid `var`.
- Keep functions small and single-purpose.

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

The release workflow then runs the full check suite, builds `dist/`, commits it
on top of the tagged commit, moves the tag to that commit, creates the GitHub
Release, and moves the major version tag (e.g. `1`). The release commit is
reachable only through the tags, so `main` never contains `dist/`. Afterwards,
run `git fetch --tags --force` to update your local tag.

To try a release first, push a pre-release tag such as `1.2.3-rc.1`. The
workflow then marks the GitHub Release as a pre-release and leaves the major
version tag alone.
