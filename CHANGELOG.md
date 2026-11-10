# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The bundled `dist/` is no longer committed to `main`; the release workflow
  builds it and tags a release commit that contains it. Reference the action by
  a release tag or SHA, not by `main`.

## [0.1.0] - 2026-06-05

### Added

- Initial release.
