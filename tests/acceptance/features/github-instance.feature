Feature: Running on GitHub.com and on GitHub Enterprise Server
  The action talks only to the GitHub instance its runner belongs to. On
  GitHub.com, Dependabot is always account 49699333; a GHES instance has its
  own Dependabot account ID.

  Background:
    Given a genuine Dependabot PR whose head commit is "def456"

  Scenario: The API URL comes from the runner, not from github-api-url
    Given the "github-api-url" input is "https://attacker.example/api"
    When the action runs
    Then the GitHub API client uses "https://api.github.com"
    And the "verified" output is "true"

  Scenario: Expected login and ID set to a person's account fail on GitHub.com
    Given the "expected-login" input is "mallory"
    And the "expected-id" input is "1000001"
    And the PR field "user" is {"login": "mallory", "id": 1000001, "type": "User"}
    And the GitHub API returns commits fixture "commits_human_author.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "expected-id"

  Scenario: On GHES the API URL comes from the runner
    Given the "GITHUB_SERVER_URL" environment variable is "https://ghes.example.com"
    And the "GITHUB_API_URL" environment variable is "https://ghes.example.com/api/v3"
    When the action runs
    Then the GitHub API client uses "https://ghes.example.com/api/v3"
    And the "verified" output is "true"

  Scenario: On GHES a Dependabot account with its own ID passes
    Given the "GITHUB_SERVER_URL" environment variable is "https://ghes.example.com"
    And the "GITHUB_API_URL" environment variable is "https://ghes.example.com/api/v3"
    And the "expected-id" input is "1000002"
    And the "expected-web-flow-id" input is "1000003"
    And the PR field "user.id" is 1000002
    And the GitHub API returns commits fixture "commits_verified_ghes.json"
    When the action runs
    Then the "verified" output is "true"
    And the action does not fail

  # The instance comes from the runner's server URL, not from expected-id. A
  # GHES instance whose Dependabot account happens to hold GitHub.com's ID must
  # not be treated as GitHub.com, or its own web-flow account is rejected.
  Scenario: On GHES a Dependabot account holding GitHub.com's ID still uses the instance's web-flow ID
    Given the "GITHUB_SERVER_URL" environment variable is "https://ghes.example.com"
    And the "GITHUB_API_URL" environment variable is "https://ghes.example.com/api/v3"
    And the "expected-web-flow-id" input is "1000003"
    And every commit field "committer.id" is 1000003
    When the action runs
    Then the "verified" output is "true"
    And the action does not fail

  Scenario: On GHES a committer claiming web-flow with another account ID fails
    Given the "GITHUB_SERVER_URL" environment variable is "https://ghes.example.com"
    And the "GITHUB_API_URL" environment variable is "https://ghes.example.com/api/v3"
    And the "expected-id" input is "1000002"
    And the "expected-web-flow-id" input is "1000003"
    And the PR field "user.id" is 1000002
    And the GitHub API returns commits fixture "commits_verified_ghes.json"
    And every commit field "committer.id" is 1000004
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "not 1000003"

  Scenario: On GitHub.com another expected-web-flow-id fails the action
    Given the "expected-web-flow-id" input is "1000003"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "expected-web-flow-id"

  Scenario: Expected login and ID set to a person's account fail on GHES
    Given the "GITHUB_SERVER_URL" environment variable is "https://ghes.example.com"
    And the "GITHUB_API_URL" environment variable is "https://ghes.example.com/api/v3"
    And the "expected-login" input is "mallory"
    And the "expected-id" input is "1000001"
    And the PR field "user" is {"login": "mallory", "id": 1000001, "type": "User"}
    And the GitHub API returns commits fixture "commits_human_author.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "PR author login"
