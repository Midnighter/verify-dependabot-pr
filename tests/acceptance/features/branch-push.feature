Feature: Checking who last pushed the PR's head branch
  A commit cannot say who put it on a branch. GitHub makes Dependabot the
  author of a squash merge, web-flow its committer, and signs it, whatever
  commits the PR held, so such a commit passes every check on its own
  metadata. The remaining signal is the push: on a genuine Dependabot PR the
  newest push to the head branch is Dependabot's, and it ends at the commit
  being verified.

  Background:
    Given a genuine Dependabot PR whose head commit is "def456"

  # Fail closed. The check reads one endpoint, so an endpoint that is not
  # there, or a branch with nothing recorded, must refuse. Reading either as a
  # pass would turn the check off with nothing to show that it had happened.
  Scenario: A repository activity endpoint that is not there fails the action
    Given the repository activity API responds with status 404
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "Not Found"

  Scenario: A head branch with no recorded activity fails the action
    Given the repository activity API returns no entries
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "No push to"

  Scenario: Activity that records no push at all fails the action
    Given the repository activity API returns fixture "activity_no_push.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "No push to"

  Scenario: A PR whose newest push is Dependabot's, ending at the head commit, passes
    When the action runs
    Then the "verified" output is "true"
    And the action does not fail

  # The attack the commit checks cannot see: someone with push access squash
  # merges a Dependabot PR carrying their own change, then force-pushes the
  # signed result onto this branch.
  Scenario: A head commit force-pushed by a person fails
    Given the repository activity API returns fixture "activity_human_push.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "was made by "mallory""

  # The same hole without a squash merge: point the branch at an older genuine
  # Dependabot commit, whose update has since been superseded.
  Scenario: A Dependabot push that ended at another commit fails
    Given the repository activity API returns fixture "activity_stale_push.json"
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "ended at abc123"

  Scenario: A push whose actor is an account holding Dependabot's login but another ID fails
    Given the newest activity entry field "actor.id" is 1000001
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "account ID 1000001"

  Scenario: A push with no actor metadata fails
    Given the newest activity entry field "actor" is null
    When the action runs
    Then the "verified" output is "false"
    And the action fails with a message containing "no actor"

  # A merged PR's branch is deleted, and the deletion is the newest entry of
  # any kind. The check reads the newest push, so a later deletion or merge
  # does not hide who pushed the commit.
  Scenario: A branch deleted after Dependabot's push still verifies
    Given the repository activity API returns fixture "activity_deleted_branch.json"
    When the action runs
    Then the "verified" output is "true"
    And the action does not fail
