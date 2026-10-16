#!/usr/bin/env bash
# Move a renderer channel tag to a build that already exists.
#
#   retag-channel.sh <stable|canary> <commit>
#
# The build is the image the renderer's CD tagged `sha-<first seven characters of the commit>`.
# Needs `docker` logged in to ghcr.io with permission to push the image.
set -euo pipefail

channel="${1:?usage: retag-channel.sh <stable|canary> <commit>}"
commit="${2:?usage: retag-channel.sh <stable|canary> <commit>}"
image="${IMAGE:-ghcr.io/beyondessential/infra-argo-tamanu-renderer}"

case "$channel" in
  stable | canary) ;;
  *) echo "unknown channel '$channel', use stable or canary" >&2; exit 2 ;;
esac
if ! [[ "$commit" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "'$commit' is not a commit" >&2
  exit 2
fi
source_tag="sha-${commit:0:7}"

# spec: TRO#promotion
# The build has to exist: a promotion never builds, so what stable serves is what canary served.
if ! docker buildx imagetools inspect "$image:$source_tag" > /dev/null; then
  echo "There is no build of the renderer tagged $source_tag, so there is nothing to promote" >&2
  exit 1
fi

# spec: TRO#channels
docker buildx imagetools create --tag "$image:$channel" "$image:$source_tag"
docker buildx imagetools inspect "$image:$channel"
