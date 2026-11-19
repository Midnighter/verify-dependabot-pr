Feature: Failing closed on invalid input and API errors
  When the action cannot check a PR, because an input is invalid or the
  GitHub API fails, it fails instead of letting the PR through.

  Background:
    Given a genuine Dependabot PR whose head commit is "def456"

  Scenario: Missing PR number fails the action
    Given the "pr-number" input is ""
    When the action runs
    Then the action fails with a message containing "pr-number is required"
    And the "verified" output is "false"

  Scenario: Invalid PR number fails the action
    Given the "pr-number" input is "not-a-number"
    When the action runs
    Then the action fails with a message containing "must be a positive integer"
    And the "verified" output is "false"

  Scenario: Missing head SHA fails the action
    Given the "head-sha" input is ""
    When the action runs
    Then the action fails with a message containing "head-sha is required"
    And the "verified" output is "false"

  Scenario: Invalid expected-id fails the action
    Given the "expected-id" input is "not-a-number"
    When the action runs
    Then the action fails with a message containing "expected-id must be a positive integer"
    And the "verified" output is "false"

  # parseInt reads a number off the front of these and ignores the rest, so the
  # action used to check a PR the workflow never named.
  Scenario Outline: A PR number that is not a whole number fails the action
    Given the "pr-number" input is "<value>"
    When the action runs
    Then the action fails with a message containing "pr-number must be a positive integer"
    And the "verified" output is "false"

    Examples:
      | value |
      | 12abc |
      | 42.9  |
      | 1e3   |
      | 0     |
      | -1    |

  Scenario: An expected-id with trailing characters fails the action
    Given the "expected-id" input is "49699333x"
    When the action runs
    Then the action fails with a message containing "expected-id must be a positive integer"
    And the "verified" output is "false"

  Scenario: Invalid expected-web-flow-id fails the action
    Given the "expected-web-flow-id" input is "not-a-number"
    When the action runs
    Then the action fails with a message containing "expected-web-flow-id must be a positive integer"
    And the "verified" output is "false"

  Scenario: Non-Error exception is handled gracefully
    Given the GitHub API throws a non-Error value "string-error"
    When the action runs
    Then the action fails with a message containing "An unexpected error occurred"
    And the "verified" output is "false"
