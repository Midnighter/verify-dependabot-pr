#!/usr/bin/env bash
#
# Adds the built bundle in dist/ to a release tag:
#
#   1. Upload every file in dist/ to GitHub as a blob.
#   2. Create a tree: the tagged commit's tree plus those files.
#   3. Check that this tree is identical to the one git computes locally from
#      the same files, so the release contains exactly the built bundle.
#   4. Create a commit with that tree whose parent is the tagged commit.
#   5. Move the tag to that commit.
#
# Why: GitHub runs a JavaScript action from the files in the commit that a
# workflow references, so the tagged commit must contain dist/. main does not
# contain dist/; the bundle exists only in these release commits.
#
# The commit is created through GitHub's Git Database API rather than with
# `git commit` because GitHub signs commits it creates for GITHUB_TOKEN, so the
# release commit shows as "Verified". A commit made on the runner and pushed
# would be unsigned.
#
# Runs in the release workflow, after checking out the pushed tag and
# downloading the bundle into dist/. Needs GH_TOKEN with contents: write and
# GITHUB_REPOSITORY (set by GitHub Actions).
#
#   scripts/create_release_commit.sh <tag>
#
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <tag>" >&2
  exit 2
fi
TAG="$1"
API="repos/${GITHUB_REPOSITORY}/git"

# 1. Upload the files. The API takes the content as JSON, so encode it as
#    base64 to transfer the bytes unchanged.
tree_entries=()
for file in dist/*; do
  blob_sha=$(base64 --wrap=0 "${file}" \
    | jq --raw-input '{content: ., encoding: "base64"}' \
    | gh api "${API}/blobs" --input - --jq .sha)
  tree_entries+=("$(jq --null-input --arg path "${file}" --arg sha "${blob_sha}" \
    '{path: $path, mode: "100644", type: "blob", sha: $sha}')")
done

# 2. Create the tree. `base_tree` keeps every file of the tagged commit and
#    adds the entries on top.
tree_sha=$(printf '%s\n' "${tree_entries[@]}" \
  | jq --slurp --arg base_tree "$(git rev-parse 'HEAD^{tree}')" '{base_tree: $base_tree, tree: .}' \
  | gh api "${API}/trees" --input - --jq .sha)

# 3. Equal tree hashes mean identical contents.
git add --force dist/
if [[ "${tree_sha}" != "$(git write-tree)" ]]; then
  echo "::error::The tree created on GitHub does not match the local dist/."
  exit 1
fi

# 4. No author or committer is passed, so GitHub sets them and signs the
#    commit.
commit_sha=$(gh api "${API}/commits" \
  -f message="chore: build ${TAG}" \
  -f tree="${tree_sha}" \
  -f "parents[]=$(git rev-parse HEAD)" \
  --jq .sha)

# 5. This runs before the GitHub release is created, because with immutable
#    releases enabled a released tag can no longer be moved.
gh api --method PATCH "${API}/refs/tags/${TAG}" -f sha="${commit_sha}" -F force=true --silent

echo "Moved tag ${TAG} to release commit ${commit_sha}."
