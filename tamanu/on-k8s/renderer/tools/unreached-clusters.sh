#!/usr/bin/env bash
# After a promotion run in which some clusters failed, name them and say how to repeat it for
# those alone. Run by the promotion workflow, which sets GH_TOKEN, GITHUB_REPOSITORY and
# GITHUB_RUN_ID, with the channel and the commit that was being promoted.
#
#   unreached-clusters.sh <stable|canary> <commit>
set -euo pipefail

channel="${1:?usage: unreached-clusters.sh <stable|canary> <commit>}"
commit="${2:?usage: unreached-clusters.sh <stable|canary> <commit>}"

# Each cluster's refresh is a job named "Refresh <cluster>". Called from another workflow the
# name is prefixed with the calling job's, so it is matched at the end.
failed=$(
  gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs" \
    --jq '.jobs[]
      | select((.name | contains("Refresh ")) and .conclusion == "failure")
      | .name | sub(".*Refresh "; "")' |
    paste -sd' '
)

# r[impl promotion.partial]
{
  echo "### Promotion of $channel did not reach: $failed"
  echo
  echo "The tag has moved, so those clusters serve a different render from the others until this is repeated."
  echo "Run the workflow again with channel \`$channel\`, commit \`$commit\`, clusters \`$failed\` and retag off."
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 1
