# C1: renderer rollout by channel

Scenarios that show a renderer change reaching only the deployments on the promoted channel. Citations are the requirement ids in `docs/spec/tamanu/renderer-rollout.md`. Ticked cases are covered by an automated test: `pulumi/common/tamanuRenderer*.test.ts`, `pulumi/tamanu/on-k8s/src/argo/paramsDocument.test.ts` and `tamanu/on-k8s/renderer/tests/stub.rs`.

## Channel selection

- [x] A stack with no `rendererChannel`, or the string `"null"`, is rendered by stable (`channel.default`)
- [x] `canary` and `stable` are accepted, and any other value is refused with the accepted ones listed (`channel.unknown`)
- [x] The stable plugin keeps the name existing Applications refer to, and each channel's plugin name differs (`channel.stable-continuity`, `plugin.per-channel`)
- [x] `rendererChannel` is never part of the parameters sent to the renderer (`params.channel-not-forwarded`)
- [ ] A deployment switched from stable to canary, and back, is rendered by the other channel after the next `up`, with no refresh (`channel.switch`)
- [ ] An Application created before channels existed is rendered by stable after the new sidecars are applied, without being redeployed (`channel.stable-continuity`)
- [ ] An Application carries `bes.tamanu/renderer-channel` and the Argo CD interface can filter on it (`params.channel-label`)

## Parameters

- [x] The stub's output for each channel matches the committed fixtures (`params.checked-per-channel`)
- [x] The renderer built from the tree accepts and renders the canary fixture (`params.checked-per-channel`)
- [ ] The published `:stable` image renders the stable fixture in CI, after the first stable promotion (`params.checked-per-channel`)
- [x] A renderer set to reject refuses an unknown stack config key and names it, one set to ignore renders as if it were absent, and a key outside stack config is still rejected (`params.unknown-config-keys`)
- [x] The sidecar setting is `ignore` for stable and `reject` for canary, under the variable the renderer reads (`params.unknown-config-keys`)
- [ ] After a renderer with the setting is promoted to stable, a stable deployment with a key stable does not know renders and the sidecar log reports it, while the same key on a canary deployment fails with a message naming it (`params.unknown-config-keys`)
- [ ] When the stub's parameters change shape, stable's conversion keeps stable deployments rendering while canary receives the new shape (`params.per-channel-shape`)

## Sidecars

- [ ] Both plugin sidecars are running on the repo server of each cluster after `k8s-infra` is applied, each with its own plugin registered (`plugin.per-channel`)
- [ ] The sidecars' plugin config comes from their ConfigMaps, and changing it replaces the repo server pod (`plugin.config-supplied`)
- [ ] A sidecar pulls its channel tag on every start (`plugin.pull`)

## Promotion

- [x] A canary promotion annotates only the Applications rendered by the canary plugin, and a stable one only stable's (`promotion.refresh`)
- [x] The repo server has restarted and rolled out before the first Application is refreshed (`promotion.restart`)
- [x] A render error, a sync that failed after the refresh, or Applications that have not rendered in time fail the promotion, and a sync that failed before it does not (`promotion.outcome`)
- [x] Every build from main is promoted to canary once built, stable moves only by a run naming the commit, and promotions are serialised (`promotion.canary`, `promotion.stable`, `promotion.serialised`)
- [x] The tag moves only through a script that refuses a build that does not exist (`promotion.from-build`)
- [ ] Promoting a commit with no built image fails without moving the tag (`promotion.from-build`)
- [ ] A promotion reaches both clusters, and one cluster failing leaves the other refreshed and names the failed one (`promotion.clusters`, `promotion.partial`)
- [ ] Repeating a promotion with `retag` off and one cluster named refreshes that cluster without moving the tag (`promotion.partial`)
- [ ] Argo's refresh annotation is removed once a refresh is processed, on the Argo CD version in use, so the wait loop ends (`promotion.outcome`)
- [ ] Acceptance: with a canary deployment and a stable one on the demo cluster, promoting a harmless renderer change to canary re-renders only the canary one, with no change to the stable one

## Access

- [ ] The promotion identity can restart the repo server and refresh Applications, and `kubectl auth can-i` says no to creating an Application or acting on anything else (`access.promotion-identity`)
