# Other rules

- This repository is public. Never commit secrets or credentials, and keep client-identifying names out of code, comments, commits and PRs beyond the deployment names already present. Stack config (`Pulumi.<stack>.yaml`) is gitignored and must stay so: values go in via `pulumi config set` (`--secret` for secrets), never in source.
- If you write a script, always remind the user to carefully review the script before running it.
- Troubleshooting and procedures are in the support pack at `docs/`: [docs/README.md](docs/README.md) indexes the runbooks, SOPs and reference pages, `docs/ruled-out-actions.md` is the hard filter on suggested actions, and `docs/deployment-context.md` says how to work out which deployment is affected. When a change alters something a runbook or SOP describes, update it, following the `curate-support-docs` skill.
- Developer orientation is in `docs/dev/`: `pulumi-organisation.md` for how `pulumi/` is laid out and the conventions every stack follows, and `pulumi-core.md` for the per-account core stack. What each part of the system must do is in `docs/spec/`.
- When writing or changing specs in `docs/spec/` or plans in `docs/plans/` or `.workhorse/plans/`, follow the spec and plan rules in [.workhorse/rules.md](.workhorse/rules.md). Run `node scripts/check-spec-links.mjs` after editing specs or `spec:` citations.
- Assume these tools are available, you can use them all the time instead of more standard tools like grep etc:
  - rg
  - jq
  - fish
  - node
  - tree
- When available, use the `skim` tool to read code more efficiently.

- When updating the Ansible playbooks, also update `ansible/variables.schema.json`, the catalogue Canopy reads from main. Run `uv run python catalogue.py tags` in `ansible/` after a playbook or role gains or loses a tag (CI runs it with `--check`), and add or change the entry of any variable in the `Inventory variables` tables of the Linux specs. [docs/reference/linux-inventory.md](docs/reference/linux-inventory.md#the-variable-catalogue) says how.

## AWS

- We have an AWS organisation with over 25 member accounts. Avoid suggestions that involve editing things manually as that gets extremely tedious and error-prone. Prefer instead to write scripts that apply changes to all accounts, or to use Pulumi, or both.
- You can run commands using `[accountname]:ReadAccess` profiles with aws-sso, but never directly run commands with other access levels: instead ask the user to run commands or scripts.
- The general calling form for aws-sso is `aws-sso exec -p [profile] -- [command]`. You'll need to look up the account list to get the profiles with `aws-sso list`.
- You can run previews with pulumi, but never directly run `up` or other destructive actions.
- Note that about half of our pulumi stacks DO NOT require AWS access at all, and so should not use aws-sso at all.
- If `aws-sso` says that you need to run `aws-sso login`, pause and ask the user to do so, then repeat the commands and resume.
- If you're about to run a command that uses AdminAccess, immediately stop yourself. Even if a ReadAccess doesn't exist where you expect it, ask the user to fix the situation instead of running an AdminAccess command yourself.

## Pulumi

- Run previews as `pulumi preview --policy-pack <path to pulumi/policies>` so the `bes-guardrails` pack is enforced. Run `npm run build` in `pulumi/policies` first: the pack loads from gitignored `bin/`, so a stale build silently skips rules instead of failing.
- In pulumi code, instead of `something.apply((thing) => JSON.stringify({ a: thing }))`, use `jsonStringify({ a: something })` where `jsonStringify` is from `@pulumi/pulumi`.
- In pulumi code, don't include a resource in `dependsOn` if that resource is already used in the attributes of the resource.
- In pulumi kubernetes resources, don't specify the metadata.name of a resource unless it's absolutely needed.
- When writing tags, prefer values in lower-kebab-case and keys in PascalCase. Whenever appropriate, fold in tags defined in a config.ts if present. There are utility functions in pulumi/common/tags.ts to transform between various tag formats expected by AWS.
- If there's an error like `tailscale provider credentials are empty` for pulumi, advise the user to run `pulumi config env add tamanu-on-linux --yes` with the relevant pulumi stack selected.
- When using `aws-native:iam:ManagedPolicy`, always add `ignoreChanges: ['users', 'roles', 'groups']` to resource options. Otherwise `pulumi up --refresh` will detect the attachment from the other side (User/Role), then remove it via CloudFormation, detaching the policy.
- Use pulumi/scripts/refreshConfigs.fish to refresh local pulumi config files when needed.

- When creating a new pulumi K8s stack, follow these conventions:
  - Put TypeScript files in a `src/` subfolder; set `"main": "src/index.ts"` in package.json.
  - Import `cfg` from `common/k8s/coreRef.ts` rather than creating a new `Config()`.
  - Put config values in `src/config.ts`, not inline in index.ts.
  - For container images, hardcode the registry/image path and use a required `imageTag` config for the tag.
  - Look at existing stacks like `agent-slack` for reference.
  - The `k8s-core` config key is required and references the cluster cross-stack (e.g. `bes/k8s-core/tamanu-internal-main`).

