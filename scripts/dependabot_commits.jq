# Succeeds when every commit on a pull request comes from Dependabot.
#
# A copy of the rules in src/policy.ts, kept as a separate file so that
# scripts/merge_dependabot_prs.sh and the test that compares the two verdicts
# read the same filter rather than their own copies of it.
#
# Input: the pages of repos/:owner/:repo/pulls/:number/commits, slurped into an
# array of arrays. Arguments: $head, the commit the checks passed on; $total,
# the PR's own commit count; $id, Dependabot's account ID; $web_flow_id,
# web-flow's account ID; $max, the most commits the API lists for a PR.
#
# Returns false rather than erroring, so a caller reads the verdict from the
# output and jq --exit-status turns it into an exit code.
add
| length > 0
  and length < $max
  and length == $total
  and .[-1].sha == $head
  and all(.[];
    .author != null and .committer != null
    and .author.login == "dependabot[bot]" and .author.id == $id
    and .commit.verification.verified == true
    and (
      (.committer.login == "web-flow" and .committer.id == $web_flow_id)
      or (.committer.login == "dependabot[bot]" and .committer.id == $id)
    ))
