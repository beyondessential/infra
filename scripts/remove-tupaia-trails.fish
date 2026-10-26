#!/usr/bin/env fish
# Remove the _Internal_Tupaia trails that no stack manages, their buckets, and the
# lambda-cloudtrail KMS key. Two were made by hand; cloudtrail-9167b63 was core's, left
# behind when state imports dropped it from the tupaia-internal stack. The organisation event store records this account's
# management events; the Lambda data events lambda-cloudtrail records stop with it.
#
# Two runs:
#   scripts/remove-tupaia-trails.fish                  # delete trails, expire bucket contents, schedule key deletion
#   scripts/remove-tupaia-trails.fish --delete-buckets # a few days later, once lifecycle has emptied the buckets
#
# The buckets are emptied by lifecycle rather than by listing and deleting each version:
# the big one holds five years of versioned log files, and expiry is free and can't time out.

set -g profile _Internal_Tupaia:AdminAccess
set -g region ap-southeast-2
set -g trails bes-cloudtrail cloudtrail-9167b63 lambda-cloudtrail
set -g buckets aws-cloudtrail-logs-843218180240-86c78744 aws-cloudtrail-logs-843218180240-25a8bb58 bes-cloudtrail
set -g key 618162cc-87eb-45da-b4a2-75c167dd337c
set -g account 843218180240
set -g management _BES_Primary:AdminAccess

function x
    aws-sso exec --sts-refresh -p $profile -- $argv
end

function fail
    echo "FAILED: $argv" >&2
    exit 1
end

aws-sso exec -p $profile -- true 2>/dev/null; or aws-sso login; or fail "aws-sso login"

if contains -- --delete-buckets $argv
    for b in $buckets
        set -l left (x aws s3api list-object-versions --bucket $b --max-items 1 --output json | jq '(.Versions // []) + (.DeleteMarkers // []) | length')
        or fail "list $b"
        if test "$left" != 0
            echo "skip $b: not empty yet, run again later"
            continue
        end
        x aws s3api delete-bucket --bucket $b --region $region; or fail "delete $b"
        echo "deleted $b"
    end
    exit 0
end

# bes-cloudtrail's policy denies even AdminAccess. When it does, remove it from a root
# session limited to unlocking a bucket policy, which the management account can start in
# any member account (centralized root access); a copy of the policy is kept first.
echo "==> bes-cloudtrail policy"
if not x aws s3api get-bucket-policy --bucket bes-cloudtrail --output json >/dev/null 2>&1
    echo "    denied to AdminAccess; unlocking from a root session"
    set -l root (aws-sso exec --sts-refresh -p $management -- aws sts assume-root \
        --target-principal $account \
        --task-policy-arn arn=arn:aws:iam::aws:policy/root-task/S3UnlockBucketPolicy \
        --output json | jq -r '.Credentials | .AccessKeyId, .SecretAccessKey, .SessionToken')
    test (count $root) -eq 3; or fail "assume-root in $account"
    set -l as_root env -u AWS_PROFILE AWS_ACCESS_KEY_ID=$root[1] AWS_SECRET_ACCESS_KEY=$root[2] AWS_SESSION_TOKEN=$root[3]
    set -l saved (mktemp --suffix=-bes-cloudtrail-policy.json)
    $as_root aws s3api get-bucket-policy --bucket bes-cloudtrail --output json | jq -r .Policy | jq . >$saved
    and echo "    policy saved to $saved"
    or echo "    the root session can't read the policy; removing it unsaved"
    $as_root aws s3api delete-bucket-policy --bucket bes-cloudtrail; or fail "delete bes-cloudtrail policy"
end

set -l lifecycle (mktemp --suffix=.json)
echo '{"Rules":[
  {"ID":"empty-for-deletion","Status":"Enabled","Filter":{},
   "Expiration":{"Days":1},"NoncurrentVersionExpiration":{"NoncurrentDays":1},
   "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}},
  {"ID":"remove-delete-markers","Status":"Enabled","Filter":{},
   "Expiration":{"ExpiredObjectDeleteMarker":true}}]}' >$lifecycle

for b in $buckets
    echo "==> expire contents of $b"
    x aws s3api put-bucket-lifecycle-configuration --bucket $b --lifecycle-configuration file://$lifecycle
    or fail "lifecycle on $b"
end

for t in $trails
    echo "==> delete trail $t"
    x aws cloudtrail delete-trail --name $t --region $region; or fail "delete trail $t"
end

echo "==> schedule deletion of the lambda-cloudtrail key"
x aws kms schedule-key-deletion --key-id $key --pending-window-in-days 30 --region $region --output json | jq -c .
or fail "schedule key deletion"

echo "==> Done. Run again with --delete-buckets in a few days."
