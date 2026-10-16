#!/usr/bin/env fish

# Empty a versioned, object-locked S3 bucket.
#
# The kopia backup buckets are versioned with a 30-day GOVERNANCE object lock, so
# a plain `aws s3 rm --recursive` leaves noncurrent versions behind and refuses
# the locked ones. This deletes every version and delete marker, bypassing the
# lock — which needs s3:BypassGovernanceRetention.
#
# Usage:
#   scripts/empty-locked-bucket.fish BUCKET [--execute]
#
# THIS IS IRREVERSIBLE. Confirm the bucket name before running with --execute.

argparse execute -- $argv; or exit 1

if test (count $argv) -lt 1
    echo "usage: empty-locked-bucket.fish BUCKET [--execute]" >&2
    exit 1
end

set -l bucket $argv[1]

if not aws s3api head-bucket --bucket $bucket 2>/dev/null
    echo "$bucket does not exist or is not reachable; nothing to do"
    exit 0
end

# Paginated: a kopia repository can hold a great many blobs, and
# list-object-versions caps each page at 1000.
set -l token ''
set -l total 0
while true
    set -l page
    if test -z "$token"
        set page (aws s3api list-object-versions --bucket $bucket --max-keys 1000 --output json | string collect)
    else
        set page (aws s3api list-object-versions --bucket $bucket --max-keys 1000 \
            --key-marker (string split \t $token)[1] \
            --version-id-marker (string split \t $token)[2] --output json | string collect)
    end

    set -l objects (echo $page | jq -c '[(.Versions // []) + (.DeleteMarkers // [])
        | .[] | {Key, VersionId}]')
    set -l count (echo $objects | jq 'length')
    if test $count -eq 0
        break
    end

    set total (math $total + $count)
    if set -q _flag_execute
        echo $objects | jq -c '{Objects: ., Quiet: true}' \
            | aws s3api delete-objects --bucket $bucket --bypass-governance-retention \
                --delete file:///dev/stdin >/dev/null
        or begin
            echo "delete failed" >&2
            exit 1
        end
    end
    echo "  $count version(s)"

    set -l truncated (echo $page | jq -r '.IsTruncated')
    if test "$truncated" != true
        break
    end
    # Tab-separated, and each defaulted: a missing NextVersionIdMarker makes jq
    # fail outright on string + null, and a key containing a space would split
    # wrongly on one.
    set token (echo $page | jq -r '(.NextKeyMarker // "") + "\t" + (.NextVersionIdMarker // "")' | string collect)
end

echo "  $total version(s) total"
if set -q _flag_execute
    # Emptied, not deleted — the name says so, and the bucket belongs to Pulumi,
    # which deletes it when the stack drops it. Deleting it here leaves Pulumi
    # deleting something already gone.
    echo "  emptied; pulumi deletes the bucket itself"
else
    echo "  dry run: nothing deleted. Re-run with --execute."
end
