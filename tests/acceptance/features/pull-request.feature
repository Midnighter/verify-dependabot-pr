Feature: Checking who opened the PR and where its branch lives
  Only a PR that Dependabot opened, from a branch in the repository itself,
  passes.

  Background:
    Given a genuine Dependabot PR whose head commit is "def456"

  Scenario: Successful Dependabot PR verification
    When the action runs
    Then the "verified" output is "true"
    And the action does not fail

  Scenario: PR author login mismatch fails verification
    Given the PR field "user.login" is "not-dependabot"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "does not match"
