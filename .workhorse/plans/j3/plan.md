# Remove the emergency SSH key

Specs: LNXAWS (first boot, recovery access) and LNXSRV (access). Runbook: `docs/runbooks/linux-server-unreachable.md`.

## Code

- [x] Remove `emergencySshKeyCommands` from `pulumi/common/cloudInit.ts` and `EMERGENCY_SSH_KEY` from `pulumi/constants/internal.ts`, and drop their uses in `pulumi/tamanu/on-linux/src/instances.ts`, `pulumi/common/TailscaleBox.ts`, `pulumi/ts-relay/index.ts` and `pulumi/ts-relay-verify/index.ts`.
- [x] Add an SSM agent install and start command to `cloudInit.ts`, before the Tailscale join, and use it in `instances.ts`. The snap route follows the AWS guidance for Ubuntu; the BES Linux image does not ship the agent.
- [ ] Confirm the install works on a booted BES Linux image: the snap installs at first boot and the agent registers with Systems Manager.
- [x] In `pulumi/tamanu/on-linux`, add one IAM role per stack with only `AmazonSSMManagedInstanceCore`, an instance profile, and attach it to the instances. The role uses the classic `aws.iam.Role` with `managedPolicyArns`, so the `aws-native` `ignoreChanges` rule does not apply.
- [x] Remove the unused `sshKey` config in `pulumi/tamanu/on-linux/src/config.ts` if nothing reads it, and its `keyName` row in `docs/reference/linux-pulumi-config.md`.

## Ansible

- [x] Baseline task that removes the `emergency@tamanu` key line from the `ubuntu` user's `authorized_keys` and leaves other lines, using builtin modules only (no collections are installed). Match on the key material, not only the comment.
- [x] Baseline task that installs, enables and starts the SSM agent on a server that is an instance, and does nothing elsewhere.
- [x] Give both tasks tags, add them to the `base-install.yml` entry of `ansible/variables.schema.json` with `uv run python catalogue.py tags` in `ansible/`.
- [x] Ansible test for the removal: key present among others, key absent, file missing. The no-`ubuntu`-user skip is only a `when` and is listed in the test cases.

## Docs

- [x] `docs/dev/pulumi-organisation.md` lines on `cloudInit.ts`, `TailscaleBox.ts` and `internal.ts` no longer mention the emergency key.
- [x] `docs/sops/linux-provision-server.md` step 4 mentions that Session Manager is the way in if the join fails.
- [x] `node scripts/check-spec-links.mjs` passes.
- [ ] A `pulumi preview` with the policy pack, run by a person with AWS access, shows each instance updated in place (instance profile) with no replacement. Not run from the agent session.
