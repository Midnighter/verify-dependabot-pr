# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this action, please report it
responsibly. **Do not open a public GitHub issue.**

### Preferred method

Use [GitHub Security Advisories](https://github.com/Midnighter/verify-dependabot-pr/security/advisories/new)
to report the vulnerability privately. This ensures the report is only visible
to the maintainers until a fix is published.

### Alternative method

Send an email to [midnighter@posteo.net](mailto:midnighter@posteo.net) with:

- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Any suggested fix (optional)

## Response Timeline

- **Acknowledgement:** Within 72 hours of receiving the report.
- **Initial assessment:** Within 7 days.
- **Fix or mitigation:** Best effort within 30 days, depending on severity.

## What Constitutes a Security Issue

For this action, security issues include:

- A bypass that allows a non-Dependabot PR to pass verification
- Information leakage (e.g., token exposure in logs)
- A way to cause the action to silently pass when it should fail
- Dependency vulnerabilities in the action's bundled runtime

## What Is NOT a Security Issue

- The action does not verify the safety of dependency updates themselves — this
  is a documented limitation, not a vulnerability.
- Feature requests for additional checks.

## Supported Versions

Only the latest major version (`v1`) receives security updates.
