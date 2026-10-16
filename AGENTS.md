<!-- BEGIN:workhorse 0.4.0 -->
# Workhorse framework

This workspace uses [Workhorse](https://github.com/beyondessential/workhorse), a spec-driven development workbench. Workhorse ships skills (invokable prompts) and reference docs into this repo to shape how AI agents work here.

- **Skills** live at `.agents/skills/` — each skill is a folder containing a `SKILL.md` with YAML frontmatter and a prompt body. `.claude/skills/` is a symlink to the same folder so Claude Code picks them up natively
- **Reference docs** live at `.agents/docs/` — long-form guidance that skill bodies cite by path (spec format conventions and similar)
- **Specs** live at `.workhorse/specs/` — acceptance criteria for each piece of work, organised into areas by subdirectory

When picking up a task, read the skill whose folder name matches what you're being asked to do — its `SKILL.md` describes how to approach the work and which reference docs to follow.

Workhorse keeps this section, the skills, and the reference docs current automatically: the first agent turn of a session smart-merges the latest release over your local edits, so your deliberate changes survive. Edit or remove it freely.
<!-- END:workhorse -->

- This repository is public. Never commit secrets or credentials, and keep client-identifying names out of code, comments, commits and PRs beyond the deployment names already present. Stack config (`Pulumi.<stack>.yaml`) is gitignored and must stay so: values go in via `pulumi config set` (`--secret` for secrets), never in source.
- NEVER write or edit readmes or documentation unless explicitly asked.
- Don't say "Perfect!" "Great!" etc all the time. It's grating, especially when I watch you make mistakes.
- When adding to this file, prefer terse instructions rather than a literal style with headers and examples etc.
- Avoid writing "obvious" comments in code.
- Don't use emojis unless absolutely necessary.
- If you write a script, always remind the user to carefully review the script before running it.
- Assume these tools are available and prefer them over more standard tools: `rg`, `jq`, `fish`, `node`, `tree`. Use `skim` to read code efficiently.
- `aws-sso` is available for AWS auth. The calling form is `aws-sso exec -p [profile] -- [command]`; look up profiles with `aws-sso list`. If it says to run `aws-sso login`, pause and ask the user to do so, then resume.
- Only ever run commands with `[accountname]:ReadAccess` profiles; for anything needing another access level, ask the user to run it. Never run an AdminAccess command, even if a ReadAccess profile is missing where you expect one: ask the user to fix that instead.
- To run commands at the organisation root account, use the `_BES_Primary:ReadAccess` profile.
- The AWS organisation has over 25 member accounts. Avoid suggestions that involve editing things manually across them; prefer scripts that apply changes to all accounts, or Pulumi, or both.
- You can run `pulumi preview`, but never `up` or other destructive actions.
- Run previews as `pulumi preview --policy-pack <path to pulumi/policies>` so the `bes-guardrails` pack is enforced. Run `npm run build` in `pulumi/policies` first: the pack loads from gitignored `bin/`, so a stale build silently skips rules instead of failing.
- About half the Pulumi stacks don't touch AWS (pure Kubernetes stacks reach the cluster over Tailscale) and must not be wrapped in `aws-sso`. When a stack does need AWS, use `aws-sso exec [options] -- pulumi [command]`.
- If Pulumi errors with `tailscale provider credentials are empty`, advise the user to run `pulumi config env add tamanu-on-linux --yes` with the relevant stack selected.
- Use `pulumi/scripts/refreshConfigs.fish` to refresh local Pulumi config files when needed.
- GuardDuty resources belong only to the `security-monitoring` stack; the policy pack rejects them elsewhere. Two stacks owning the delegated administrator would disassociate every member account when either is destroyed.
- In Pulumi code, instead of `something.apply((thing) => JSON.stringify({ a: thing }))`, use `jsonStringify({ a: something })` from `@pulumi/pulumi`.
- In Pulumi code, don't include a resource in `dependsOn` if it's already used in the attributes of the resource.
- In Pulumi Kubernetes resources, don't specify `metadata.name` unless it's absolutely needed.
- When using `aws-native:iam:ManagedPolicy`, always add `ignoreChanges: ['users', 'roles', 'groups']` to the resource options. Otherwise `pulumi up --refresh` detects the attachment from the other side (User/Role) and removes it via CloudFormation, detaching the policy.
- Tags: values in lower-kebab-case, keys in PascalCase. Fold in tags defined in a stack's `config.ts` where present. `pulumi/common/tags.ts` has helpers to convert between the tag formats AWS APIs expect.
- New Pulumi Kubernetes stacks:
  - TypeScript in a `src/` subfolder, with `"main": "src/index.ts"` in `package.json`.
  - Import `cfg` from `common/k8s/coreRef.ts` rather than creating a new `Config()`.
  - Config values in `src/config.ts`, not inline in `index.ts`.
  - For container images, hardcode the registry/image path and use a required `imageTag` config for the tag.
  - The `k8s-core` config key is required and references the cluster cross-stack (e.g. `bes/k8s-core/tamanu-internal-main`).
  - See `pulumi/agent-slack` for reference.
- Spec items in `docs/spec` describe **what** the system requires, not **how** the code achieves it. Keep implementation details out of spec text; interface contracts that external actors or other components depend on are fine.
- When adding or changing features, or fixing bugs, first change the tracey spec in `docs/spec`, then implement, then add tests whenever possible. Annotate implementations and tests with tracey references: https://tracey.bearcove.eu/guide/annotating-code/
- After changing the content of a spec item, `git add` the spec file, run `tracey bump` to mark the changed requirements stale, then update implementation and tests to match. Don't mass-update rule IDs: check every affected site against the updated requirement.
- Run `tracey query status` before finishing an edit round on specced features.
