# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2024-01-01

### Added

- Initial release
- Verify PR author login and numeric account ID
- Verify commit signatures (configurable)
- Same-repo check to block fork PRs (configurable)
- Null metadata guard (configurable)
- Committer login match (configurable, default off)
- Full commit pagination support
- GitHub Enterprise Server (GHES) support via `github-api-url` input
- Retry with exponential backoff on transient API errors
