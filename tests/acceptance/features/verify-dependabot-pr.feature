Feature: Verify Dependabot PR Action
  As a repository maintainer
  I want to verify that a PR was genuinely authored by Dependabot
  So that I can safely auto-merge dependency updates

  Background:
    Given the GitHub token is "test-token"

  Scenario: Missing PR number fails the action
    Given the "pr-number" input is ""
    When the action runs
    Then the action fails with a message containing "pr-number is required"

  Scenario: Invalid PR number fails the action
    Given the "pr-number" input is "not-a-number"
    When the action runs
    Then the action fails with a message containing "must be a positive integer"

  Scenario: Invalid expected-id fails the action
    Given the "pr-number" input is "42"
    And the "expected-id" input is "not-a-number"
    When the action runs
    Then the action fails with a message containing "expected-id must be a positive integer"

  Scenario: Successful Dependabot PR verification
    Given the "pr-number" input is "42"
    And the "expected-login" input is "dependabot[bot]"
    And the "expected-id" input is "49699333"
    And the "allowed-committer-logins" input is "web-flow"
    And the "require-verified-commits" input is enabled
    And the "require-same-repo" input is enabled
    And the "fail-on-missing-author-metadata" input is enabled
    And the "require-committer-login-match" input is disabled
    And the GitHub API returns PR fixture "pr_dependabot.json"
    And the GitHub API returns commits fixture "commits_verified.json"
    When the action runs
    Then the "verified" output is "true"
    And the action does not fail

  Scenario: PR author login mismatch fails verification
    Given the "pr-number" input is "42"
    And the "expected-login" input is "not-dependabot"
    And the "expected-id" input is "49699333"
    And the "allowed-committer-logins" input is "web-flow"
    And the "require-verified-commits" input is enabled
    And the "require-same-repo" input is enabled
    And the "fail-on-missing-author-metadata" input is enabled
    And the "require-committer-login-match" input is disabled
    And the GitHub API returns PR fixture "pr_dependabot.json"
    And the GitHub API returns commits fixture "commits_verified.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "does not match"

  Scenario: Non-Error exception is handled gracefully
    Given the "pr-number" input is "42"
    And the "expected-login" input is "dependabot[bot]"
    And the "expected-id" input is "49699333"
    And the "allowed-committer-logins" input is "web-flow"
    And the "require-verified-commits" input is enabled
    And the "require-same-repo" input is enabled
    And the "fail-on-missing-author-metadata" input is enabled
    And the "require-committer-login-match" input is disabled
    And the GitHub API throws a non-Error value "string-error"
    When the action runs
    Then the action fails with a message containing "An unexpected error occurred"
