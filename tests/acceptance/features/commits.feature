Feature: Checking that every commit comes from Dependabot
  Someone with push access can add a commit to Dependabot's branch that names
  Dependabot as its author. Only a commit that GitHub signed for Dependabot,
  with web-flow as its committer, passes.

  Background:
    Given a genuine Dependabot PR whose head commit is "def456"

  Scenario: A commit signed by its own committer with Dependabot as author fails
    Given the GitHub API returns commits fixture "commits_spoofed_author.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Commit def456 committer"

  Scenario: A commit author with Dependabot's login but another account ID fails
    Given the GitHub API returns commits fixture "commits_author_id_mismatch.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Commit def456 author ID"

  Scenario: An unsigned commit fails even with require-verified-commits disabled
    Given the "require-verified-commits" input is disabled
    And the GitHub API returns commits fixture "commits_unverified.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Commit def456 is not verified"

  Scenario: A commit without an author fails even with fail-on-missing-author-metadata disabled
    Given the "fail-on-missing-author-metadata" input is disabled
    And the "head-sha" input is "abc123"
    And the PR field "commits" is 1
    And the PR field "head.sha" is "abc123"
    And the GitHub API returns commits fixture "commits_null_author.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Commit abc123 has null author"

  Scenario: A committer added to allowed-committer-logins still fails
    Given the "require-committer-login-match" input is enabled
    And the "allowed-committer-logins" input is "web-flow,mallory"
    And the GitHub API returns commits fixture "commits_spoofed_author.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Commit def456 committer"
