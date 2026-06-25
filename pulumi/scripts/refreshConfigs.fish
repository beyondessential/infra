#!/usr/bin/env fish
# Pull every Pulumi stack's config from the backend into its local
# Pulumi.<stack>.yaml, then delete the .bak that `config refresh` leaves behind
# whenever nothing actually changed.
#
# Encrypted secrets are re-encrypted with a fresh nonce on every pull, so the
# raw file always differs byte-for-byte even when the plaintext is identical.
# The comparison is therefore done on the *decrypted* config
# (`pulumi config --show-secrets`), which ignores that re-encryption noise but
# still catches genuine value changes (secret or not).
#
# Usage:
#   common/refreshConfigs.fish                 # every project under pulumi/
#   common/refreshConfigs.fish core data/pgro  # only these project dirs (relative to pulumi/)

set -l pulumi_root (realpath (status dirname)/..)
set -l tmp (mktemp -d)
function __refreshConfigs_cleanup --on-event fish_exit --inherit-variable tmp
    rm -rf $tmp
end

set -l projects $argv
if test (count $projects) -eq 0
    pushd $pulumi_root >/dev/null
    set projects (fd -t f '^Pulumi\.yaml$' | xargs -n1 dirname | sort -u)
    popd >/dev/null
end

set -l n_clean 0
set -l n_diff 0
set -l n_new 0
set -l n_fail 0

for proj in $projects
    set -l dir $pulumi_root/$proj
    if not test -f $dir/Pulumi.yaml
        echo "skip  $proj (no Pulumi.yaml)"
        continue
    end

    set -l stacks (pulumi -C $dir stack ls --json 2>/dev/null | jq -r '.[].name')
    if test -z "$stacks"
        echo "skip  $proj (no stacks / not logged in)"
        continue
    end

    for stack in $stacks
        set -l cfg $dir/Pulumi.$stack.yaml
        set -l bak $cfg.bak

        # Decrypted config as it stands locally before the pull (empty if none).
        if not pulumi -C $dir config --show-secrets --json -s $stack >$tmp/before 2>/dev/null
            echo -n '' >$tmp/before
        end

        if not pulumi -C $dir config refresh -s $stack >/dev/null 2>&1
            echo "FAIL  $proj/$stack"
            set n_fail (math $n_fail + 1)
            continue
        end

        # No .bak means there was no local file to back up: a fresh pull.
        if not test -f $bak
            echo "new   $proj/$stack"
            set n_new (math $n_new + 1)
            continue
        end

        pulumi -C $dir config --show-secrets --json -s $stack >$tmp/after 2>/dev/null

        if cmp -s (jq -S . <$tmp/before | psub) (jq -S . <$tmp/after | psub)
            rm $bak
            echo "clean $proj/$stack"
            set n_clean (math $n_clean + 1)
        else
            echo "DIFF  $proj/$stack (kept $proj/Pulumi.$stack.yaml.bak)"
            set n_diff (math $n_diff + 1)
        end
    end
end

echo
echo "clean=$n_clean diff=$n_diff new=$n_new failed=$n_fail"
