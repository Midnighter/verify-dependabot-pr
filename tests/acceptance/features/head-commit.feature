Feature: Binding the result to the PR's head commit
  The PR can change while the workflow runs. A result only counts for the
  head commit the workflow ran for, and only when every commit was checked.

  Background:
    Given a genuine Dependabot PR whose head commit is "def456"

  Scenario: A PR whose head moved after the triggering event fails
    Given the "head-sha" input is "abc999"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "abc999"

  Scenario: A commit list that does not end at the PR head fails
    Given the "head-sha" input is "fed789"
    And the PR field "head.sha" is "fed789"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "fed789"

  Scenario: A PR with more commits than the API listed fails
    Given the PR field "commits" is 3
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "3 commits"
