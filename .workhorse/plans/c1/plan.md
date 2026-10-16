# C1: renderer rollout by channel

Builds what `docs/spec/tamanu/renderer-rollout.md` requires: `canary` and `stable` channel tags on the renderer image, one plugin sidecar per channel, a stub that picks the channel, and a promotion workflow that restarts the repo server and hard-refreshes the right Applications on both clusters. Step labels `r[...]` are the spec requirements each step answers to.

## Notes

- Stack config is gitignored and lives in the Pulumi backend. Anything marked "manual" is a config or console change for the user, and every `pulumi up` is run by the user, never by an agent.
- `argoPlugin()` has one caller, `pulumi/tamanu/k8s-infra/argo/index.ts`. Its `image` currently comes from the required `argoRenderImageTag` config on each cluster's `k8s-infra` stack. With two sidecars at fixed channel tags that key has no job left, so the plan drops it and hardcodes `stable` and `canary`, as AGENTS.md does for new stacks' image paths. The leftover key is harmless in the backend and is removed by hand.
- The stable plugin keeps its registered name `infra-argo-tamanu-renderer-v1`, and its sidecar keeps the container name `infra-argo-tamanu-renderer`. Existing Applications therefore render as before. The canary plugin is `infra-argo-tamanu-renderer-canary-v1`.
- Plugin config is supplied from a ConfigMap mounted with `subPath` over `/home/argocd/cmp-server/config/plugin.yaml`. The mount wins over the file baked into the image, so the image change (drop the baked file) can follow the Pulumi change safely, never precede it.
- The renderer image tag format from `docker/metadata-action` `type=sha` is `sha-` plus seven characters. Promotion takes that same form as its source.
- Argo removes the `argocd.argoproj.io/refresh` annotation once it has processed a refresh. The promotion's wait relies on that, so verify it against the live Argo version before trusting the wait loop.
- The wait's bound defaults to 10 minutes, set by one workflow env var.
- Today the stub and the renderer agree on one params shape, so the stable adapter starts as the identity. The step builds the seam that lets the shapes diverge later, and the first real divergence adds the first real adapter.

## 1. Prerequisite, before #tamanu/S10 merges

- [ ] `pulumi/tamanu/on-k8s/src/argo/params.ts`: add `rendererChannel` to `STUB_ONLY` (`r[params.channel-not-forwarded]`). S10 makes every Tamanu CD deploy write that key, and the renderer rejects unknown config keys.
- [ ] Land it as its own small PR, merged before S10.

## 2. Stub: channel selection and params per channel

- [ ] New `pulumi/tamanu/on-k8s/src/argo/channel.ts`: read `rendererChannel` from stack config; a missing key or the string `"null"` means `stable`; any value other than `canary` or `stable` throws an error listing the accepted channels (`r[channel.default]`, `r[channel.unknown]`). Export `channel` and `pluginName(channel)`, which gives `infra-argo-tamanu-renderer-v1` for stable and `infra-argo-tamanu-renderer-canary-v1` for canary.
- [ ] `channel.test.ts` next to it, in the `node:test` style of `reportRoles.test.ts`: default, `"null"`, each valid value, an invalid value, and the plugin names.
- [ ] `application.ts`: replace the `PLUGIN` constant with `pluginName(channel)` (`r[channel.stable-continuity]`, `r[channel.switch]`), and add `bes.tamanu/renderer-channel` to `LABELS` (`r[params.channel-label]`).
- [ ] `params.ts`: split `renderParams` into a pure `buildParams(inputs)` that takes the stack config, cluster facts, tag and version as plain values, and the existing runtime-reading wrapper that feeds it. Add `forChannel(channel, params)`: canary returns the params as built, stable runs them through the stable adapter, which is the identity until the shapes diverge (`r[params.per-channel-shape]`).
- [ ] `params.test.ts`: `buildParams` output for a representative config, and `forChannel` for each channel. The stub's own keys, `rendererChannel` included, never appear in the output.

## 3. Sidecars: `argoPlugin` and `k8s-infra`

- [ ] `pulumi/common/k8s/argoPlugin.ts`: add a `config` input holding the plugin config document. Create a ConfigMap from it and mount it at `/home/argocd/cmp-server/config/plugin.yaml` with `subPath`, through an extra volume named from the plugin name like `cmp-tmp-<name>`. Update the `image` doc comment, which currently says the config is baked in (`r[plugin.config-supplied]`).
- [ ] Same file: set `imagePullPolicy: 'Always'` on the sidecar (`r[plugin.pull]`).
- [ ] `pulumi/tamanu/k8s-infra/argo/index.ts`: two `argoPlugin` calls, stable (container `infra-argo-tamanu-renderer`, tag `stable`) and canary (container `infra-argo-tamanu-renderer-canary`, tag `canary`), each with a generated `ConfigManagementPlugin` document whose `metadata.name` is its container name and `spec.version` is `v1` (`r[plugin.per-channel]`). Drop `cfg.require('argoRenderImageTag')`.
- [ ] Same file: a Role and RoleBinding in the Argo namespace for the group `tailscale:gha:renderer-promote`. Applications: `get`, `list`, `patch`. Deployments: `get`, `watch`, `patch`, restricted by `resourceNames` to the repo-server Deployment, whose name `findRepoServer` already resolves and the `DeploymentPatch` exposes. Nothing else (`r[access.promotion-identity]`).

## 4. Renderer image and CD

- [ ] `tamanu/on-k8s/renderer/Containerfile`: remove `COPY plugin.yaml`. Delete `tamanu/on-k8s/renderer/cmp/plugin.yaml`. In `infra-argo-tamanu-renderer-cd.yml`, remove the "Add plugin config" step. Only after step 3 has been applied to both clusters.
- [ ] `infra-argo-tamanu-renderer-cd.yml`: after `build-image`, a `promote-canary` job on pushes to `main` that calls the promotion workflow for channel `canary` and the commit just built (`r[promotion.canary]`).
- [ ] New `.github/workflows/infra-argo-tamanu-renderer-promote.yml`, triggered by `workflow_call` and by `workflow_dispatch`. Inputs: `channel`, `sha`, `clusters` (default both), and `retag` (default true, false to repeat for clusters the tag already reached) (`r[promotion.stable]`, `r[promotion.partial]`). `concurrency` group `renderer-promotion` with `cancel-in-progress: false` (`r[promotion.serialised]`). Permissions `contents: read`, `packages: write`, `id-token: write`.
- [ ] Promotion workflow, retag job: `docker buildx imagetools create -t ghcr.io/beyondessential/infra-argo-tamanu-renderer:<channel> ghcr.io/beyondessential/infra-argo-tamanu-renderer:sha-<short>`. It fails if the source tag does not exist, so promotion never builds (`r[promotion.from-build]`, `r[channel.tags]`).
- [ ] Promotion workflow, per-cluster matrix job (`fail-fast: false`, `environment: ${{ matrix.cluster }}`), after retag: connect with `tailscale/github-action` and `tailscale configure kubeconfig`, as Tamanu CD's `setup-cd` does (`r[promotion.clusters]`).
  - [ ] `kubectl -n argocd-system rollout restart` of the repo-server Deployment, then `rollout status` (`r[promotion.restart]`).
  - [ ] List Applications in the `tamanu` project with `-o json`, keep those whose `spec.source.plugin.name` is the promoted channel's plugin name, annotate each `argocd.argoproj.io/refresh=hard` (`r[promotion.refresh]`).
  - [ ] Wait loop up to the bound: an Application is done once its refresh annotation is gone. Fail the job on a `ComparisonError` condition, on a sync that finished `Failed` or `Error` after the refresh began, or on timeout (`r[promotion.outcome]`).
  - [ ] A final job that fails the run and lists the clusters whose job failed, with the line to repeat for them with `retag: false` (`r[promotion.partial]`).
- [ ] Small shell script for the restart, refresh and wait steps under `tamanu/on-k8s/renderer/tools/`, so the workflow stays readable and the logic can be run by hand. The user reviews it before first use.

## 5. Contract check in CI

- [ ] Fixtures under `tamanu/on-k8s/renderer/tests/fixtures/stub/`: `canary.json` and `stable.json`, the stub's `forChannel` output for a representative config. A stub test asserts the committed files match what the stub produces, so a stub change shows up as a fixture diff.
- [ ] Renderer test in `tests/`: deserialise `canary.json` into `Params` and render it, so the tree's renderer is checked against canary's shape (`r[params.checked-per-channel]`).
- [ ] New workflow `tamanu-renderer-contract.yml`, triggered by changes under `pulumi/tamanu/on-k8s/**` and `tamanu/on-k8s/renderer/**`: run the published `:stable` image against `stable.json` (`infra-argo-tamanu-renderer --params ... --format yaml`). Needs `:stable` to exist, so it is enabled after the first stable promotion.

## 6. External and manual

- [x] `beyondessential/tailscale` PR #46: `tag:infra-gha-renderer-promote`, and a grant on each cluster's operator that impersonates the group `tailscale:gha:renderer-promote`. Needs merging.
- [ ] Manual, in the Tailscale admin: an OIDC trust for this repo's promotion workflow on each cluster, granting that tag. The workflow's `TS_TAGS` variable must name it.
- [x] GitHub environments `tamanu-internal-main` and `shared-demos-demo` on this repo, each with `TS_OAUTH_CLIENT_ID`, `TS_TAGS` and `TS_K8S_OPERATOR_HOSTNAME`.
- [ ] `pulumi config rm argoRenderImageTag` on each cluster's `k8s-infra` stack, after step 3 is applied.

## 7. Docs and spec coverage

- [ ] `tamanu/on-k8s/SUPPORT.md`, "A renderer change does not show up": a promotion does the restart and refresh, and the manual commands remain as the fallback for one Application. Add a short section on trying a change with `channel=canary` and returning to stable.
- [ ] `docs/tamanu-on-k8s.md`: the channel option and the promotion workflow, where `k8s-infra` and the Argo pieces are described.
- [ ] Annotate the code with `r[impl ...]` and `r[verify ...]` as each step lands, and run `tracey query uncovered` and `tracey query untested` before finishing.

## Rollout order

1. Prerequisite PR (section 1), merged before S10.
2. Section 6 external changes.
3. Promote the current renderer build to both `stable` and `canary` by hand, so both tags exist before any sidecar names them.
4. Sections 2 and 3 merged, then `k8s-infra` applied on `tamanu-internal-main` and `shared-demos-demo` by the user. Existing Applications keep rendering through the unchanged stable plugin name.
5. Section 4 (image and workflow), then section 5's stable check.
6. Acceptance run: with a canary-channel deployment and a stable one on the demo cluster, promote a harmless renderer change to canary. Only the canary deployment re-renders, and the stable one keeps its cached render.
