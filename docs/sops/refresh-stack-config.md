# SOP: Pull stack config to your machine

Stack config files (`Pulumi.<stack>.yaml`) are gitignored, so a fresh checkout has none.
Pull a stack's config from the Pulumi backend before you read it or change it.
Without a local file, `pulumi config set` writes a new file holding only that one key.

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.

## One stack

```fish
cd pulumi/<project>
pulumi config refresh -s bes/<project>/<stack>
```

`<project>` is the Pulumi project name from the directory's `Pulumi.yaml`, which is not always the directory name: `pulumi/tamanu/on-k8s` is `tamanu-on-k8s`.

**[diagnose]** **[sensitive-data]**: the file holds encrypted secrets and writes only to your machine.
It leaves a `.bak` of any file it replaces.

## Several projects

```fish
pulumi/scripts/refreshConfigs.fish                  # every project under pulumi/
pulumi/scripts/refreshConfigs.fish core data/pgro   # only these, relative to pulumi/
```

**[diagnose]** **[sensitive-data]**: the script compares decrypted config before and after (in a temporary directory it deletes on exit), removes the `.bak` when nothing changed, and keeps it when something did.
It needs `pulumi` logged in, `fd` and `jq`.
Read the script before running it.
Its header comment names `common/refreshConfigs.fish`; the file is `pulumi/scripts/refreshConfigs.fish`.

## Afterwards

A `DIFF` line means the backend and your file disagree: keep the `.bak`, and decide which is right before you run `pulumi up`.
Never paste decrypted config into a ticket, chat or commit.
