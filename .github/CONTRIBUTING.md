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
source and all dependencies into a single file at `dist/index.js`. This bundled
file is committed to the repository so that GitHub Actions can run it without a
separate install step.

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

## Updating dist/ before committing

The `dist/` directory contains the compiled bundle that GitHub Actions actually
runs. It **must** be kept in sync with the TypeScript source. The CI workflow
checks for drift and will fail if `dist/` is out of date.

Always run `npm run build` (or `npm run all`) and commit any changes to `dist/`
in the same commit as the source changes:

```bash
npm run all
git add dist/
git commit -m "chore: rebuild dist"
```
