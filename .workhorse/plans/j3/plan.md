# Remove the emergency SSH key

Specs: LNXAWS (first boot, recovery access) and LNXSRV (access). Runbook: `docs/runbooks/linux-server-unreachable.md`.

## Code

- [ ] Remove `emergencySshKeyCommands` from `pulumi/common/cloudInit.ts` and `EMERGENCY_SSH_KEY` from `pulumi/constants/internal.ts`, and drop their uses in `pulumi/tamanu/on-linux/src/instances.ts`, `pulumi/common/TailscaleBox.ts`, `pulumi/ts-relay/index.ts` and `pulumi/ts-relay-verify/index.ts`. The `ops` key pair on the non-on-linux boxes stays.
- [ ] Add an SSM agent install and start command to `cloudInit.ts`, before the Tailscale join, and use it in `instances.ts`. Check the install route on the BES Linux image (it does not ship the agent).
- [ ] In `pulumi/tamanu/on-linux`, add one IAM role per stack with only `AmazonSSMManagedInstanceCore`, an instance profile, and attach it to the instances. Confirm the Pulumi preview shows an in-place update and no replacement. Use `ignoreChanges: ['users', 'roles', 'groups']` if the policy is an `aws-native` managed policy.
- [ ] Remove the unused `sshKey` config in `pulumi/tamanu/on-linux/src/config.ts` if nothing reads it.

## Ansible

- [ ] Baseline task that removes the `emergency@tamanu` key line from the `ubuntu` user's `authorized_keys` and leaves other lines, using builtin modules only (no collections are installed). Match on the key material, not only the comment.
- [ ] Baseline task that installs, enables and starts the SSM agent on a server that is an instance, and does nothing elsewhere.
- [ ] Give both tasks tags, add them to the `base-install.yml` entry of `ansible/variables.schema.json` with `uv run python catalogue.py tags` in `ansible/`.
- [ ] Ansible test for the removal: key present among others, key absent, no `ubuntu` user.

## Docs

- [ ] `docs/dev/pulumi-organisation.md` lines on `cloudInit.ts`, `TailscaleBox.ts` and `internal.ts` no longer mention the emergency key.
- [ ] `docs/sops/linux-provision-server.md` step 4 mentions that Session Manager is the way in if the join fails.
- [ ] `node scripts/check-spec-links.mjs` passes.
