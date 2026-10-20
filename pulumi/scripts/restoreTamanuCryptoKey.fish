#!/usr/bin/env fish
# Put a tamanu/on-k8s stack's crypto key back to its value at an earlier update.
#
# The key, its settings PSK and the PSK's IV are RandomBytes in the stack, so a destroy
# and a fresh update generate new ones, and a database restored from before then holds
# setting secrets the servers can no longer decrypt ("Decryption failed"). This copies
# the three resources' state from version FROM into the current state; the next
# `pulumi up` then writes the old values back into the tamanu-crypto Secret.
#
# Without --apply it only compares the three values at FROM and now, by hash. With
# --apply it saves the current state (still encrypted) to
# a new temporary directory and imports the patched state.
# Plaintext passes only through a private temporary directory, removed on exit.
#
# Usage:
#   restoreTamanuCryptoKey.fish STACK FROM [--apply]
#   restoreTamanuCryptoKey.fish example-demo 10            # compare only
#   restoreTamanuCryptoKey.fish example-demo 10 --apply    # rewrite state
#
# Find FROM with `pulumi stack history`: the last update before the key changed.
# It rewrites stack state, so read it through before running it with --apply.

argparse apply -- $argv; or exit 1
if test (count $argv) -ne 2
    echo "usage: restoreTamanuCryptoKey.fish STACK FROM [--apply]" >&2
    exit 1
end
set -l stack $argv[1]
set -l from $argv[2]
set -l project (path resolve (status dirname)/../tamanu/on-k8s)
set -l names '["tamanu-crypto-key","tamanu-crypto-psk","tamanu-crypto-psk-iv"]'
set -l select '.deployment.resources[]
  | select(.type == "random:index/randomBytes:RandomBytes"
           and ((.urn | split("::")[-1]) as $n | $names | index($n)))'

set -l work (mktemp -d)
chmod 700 $work
function cleanup --on-event fish_exit --inherit-variable work
    rm -rf $work
end

pulumi -C $project stack export -s $stack --version $from --show-secrets >$work/old.json; or exit 1
pulumi -C $project stack export -s $stack --show-secrets >$work/current.json; or exit 1

echo "== $stack: value hashes at version $from and now"
for side in old current
    jq -r --argjson names $names "$select | \"\(.urn | split(\"::\")[-1]) \(.outputs.base64 | tostring)\"" \
        $work/$side.json | while read -l name value
        echo "  $side $name "(echo -n $value | sha256sum | cut -c1-12)
    end
end

if not set -q _flag_apply
    echo
    echo "Compare only. Re-run with --apply to put the values from version $from back."
    exit 0
end

jq --arg from $from --argjson names $names --slurpfile old $work/old.json '
  def short: .urn | split("::")[-1];
  def crypto: .type == "random:index/randomBytes:RandomBytes" and (short as $n | $names | index($n));
  ($old[0].deployment.resources | map(select(crypto)) | map({key: short, value: {inputs, outputs}}) | from_entries) as $prev
  | if ($prev | length) != ($names | length) then error("version \($from) lacks some of the crypto RandomBytes") else . end
  | .deployment.resources |= map(if crypto and ($prev | has(short)) then . + $prev[short] else . end)
' $work/current.json >$work/patched.json; or exit 1

set -l replaced (jq --argjson names $names "[$select] | length" $work/patched.json)
if test "$replaced" != 3
    echo "expected the 3 crypto RandomBytes in the current state, found $replaced" >&2
    exit 1
end

# Outside the working directory, so it cannot be picked up by version control.
set -l backup (mktemp -d)/$stack-state-before-crypto-restore.json
pulumi -C $project stack export -s $stack >$backup; or exit 1
pulumi -C $project stack import -s $stack --file $work/patched.json; or exit 1
echo
echo "Imported. The previous state is in $backup: import it to undo, and delete it once done."
echo "Now run \`pulumi up\` for $stack to write the key back into the tamanu-crypto Secret."
