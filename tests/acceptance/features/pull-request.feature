Feature: Checking who opened the PR and where its branch lives
  Only a PR that Dependabot opened, from a branch in the repository itself,
  passes.

  Background:
    Given a genuine Dependabot PR whose head commit is "def456"

  Scenario: Successful Dependabot PR verification
    When the action runs
    Then the "verified" output is "true"
    And the "head-sha" output is "def456"
    And the action does not fail

  Scenario: PR author login mismatch fails verification
    Given the PR field "user.login" is "not-dependabot"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "does not match"

  Scenario Outline: A fork PR fails even with require-same-repo disabled
    Given the "require-same-repo" input is disabled
    And the GitHub API returns PR fixture "<fixture>"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Fork PRs are not allowed"

    Examples:
      | fixture              |
      | pr_fork.json         |
      | pr_deleted_fork.json |

  Scenario: Head and base repositories with the same name but different IDs fail
    Given the PR field "head.repo.id" is 100002
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Fork PRs are not allowed"
