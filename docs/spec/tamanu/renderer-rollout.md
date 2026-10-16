---
id: TRO
---

# Tamanu renderer rollout

## Borrowed terms

| term | meaning |
|---|---|
| Application | An Argo CD `Application`, the declaration of one deployment that Argo CD keeps in sync ([Argo CD declarative setup](https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/)). |
| plugin | An Argo CD config management plugin, which turns the parameters of an Application into Kubernetes objects ([Argo CD config management plugins](https://argo-cd.readthedocs.io/en/stable/operator-manual/config-management-plugins/)). |
| repo server | The Argo CD component that renders Applications and caches the result ([Argo CD architecture](https://argo-cd.readthedocs.io/en/stable/operator-manual/architecture/)). |
| hard refresh | A refresh of an Application that discards its cached render ([argocd app get](https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app_get/)). |
| render error | The `ComparisonError` condition of an Application whose render failed. |

## Channels

A deployment MUST be rendered by exactly one [channel](../overview.md#channel).

The [renderer](../overview.md#renderer) image MUST be published under two channel tags, `canary` and `stable`.

Each channel tag MUST name one build of the renderer at a time.

A deployment that names no channel MUST be rendered by `stable`.

A deployment MUST be rendered by `canary` only when its configuration says so.

A deployment that names a channel other than `canary` or `stable` MUST be refused before anything changes, with a message that lists the accepted channels.

> [!NOTE]
> Accepting it would create an Application that names a plugin which does not exist, and the deployment would sit in a render error.

Changing the channel of a deployment MUST cause it to be rendered by the other channel the next time the deployment is applied, without a manual refresh.

## Plugins

Each channel MUST run as its own Argo CD plugin, registered under a plugin name of its own by a sidecar of the Argo CD repo server.

The `stable` plugin MUST register under the name `infra-argo-tamanu-renderer-v1`, and the `canary` plugin under the name `infra-argo-tamanu-renderer-canary-v1`.

> [!NOTE]
> Existing Applications refer to the `stable` name, and they are long-lived: they are not redeployed on any schedule the rollout controls.

The plugin configuration of a sidecar MUST be supplied to it when it is deployed, and MUST NOT be carried in the renderer image.

> [!NOTE]
> Both channels run the same image, so a configuration carried in it would register the same plugin name twice.

A sidecar MUST pull the renderer image at the tag of its channel every time it starts.

> [!NOTE]
> A tag that moves is otherwise served from whatever the node last pulled.

## Parameters

The setting that selects the channel of a deployment MUST NOT be passed to the renderer.

> [!NOTE]
> A channel that rejects unknown stack config keys would fail every render of the deployment on it, and one that ignores them would carry a key that means nothing to it.

A `canary` renderer MUST reject a stack config key it does not know, with a message naming the key.

A `stable` renderer MUST ignore a stack config key it does not know, and MUST report the key in its log.

> [!NOTE]
> A key the renderer does not know means either that the sender is ahead of the renderer or that the key is mistaken.
> `stable` lags the senders, so an option added by [Tamanu CD](../overview.md#tamanu-cd) must not stop the deployments on it rendering.
> `canary` is built with the sender, so a key it does not know is a mistake, and rejecting it finds the mistake.

The parameters passed to the renderer of a channel MUST be in the shape that renderer accepts.

Where the renderer of one channel accepts an older shape than the other, the parameters for a deployment on that channel MUST be converted to the older shape.

> [!NOTE]
> A change to what the infrastructure passes can then be tried on `canary` before `stable` is able to accept it.

A change to what the infrastructure passes to the renderer MUST be checked before it merges, against the renderer that each channel currently serves.

The parameters for `stable` MUST be checked against the renderer that `stable` serves.

The parameters for `canary` MUST be checked against the renderer built from the same change.

> [!NOTE]
> A shape that the renderer of a channel rejects is then found by the change that introduced it, and not by the deployments rendered with it.

An Application MUST carry its channel in the label `bes.tamanu/renderer-channel`.

## Promotion

A channel tag MUST move only by [promoting](../overview.md#promotion) a renderer image that has already been built and is identified by its commit.

A promotion MUST NOT rebuild the renderer.

> [!NOTE]
> The build that `stable` serves is then the build that `canary` served.

Each build of the renderer from the main branch MUST be promoted to `canary` automatically once its tests pass.

`stable` MUST move only when someone requests it, naming the commit to promote.

Promotions MUST run one at a time.

> [!NOTE]
> Both channels are served by one repo server, so promotions that overlap restart it under each other.

After a channel tag moves, a promotion MUST restart the Argo CD repo server of each cluster and wait for the restart to finish before it refreshes any Application.

> [!NOTE]
> A refresh answered by the old repo server stores the old render again under the same cache key, and the Application keeps serving it.

Once the repo server has restarted, a promotion MUST hard-refresh every Application in the `tamanu` project that is rendered by the plugin of the promoted channel.

A promotion MUST NOT refresh an Application rendered by the other channel.

> [!NOTE]
> An Application rendered by the other channel keeps serving its cached render.

A promotion MUST apply to every cluster that runs Tamanu deployments.

A promotion that does not reach every cluster MUST fail and name the clusters it did not reach.

A promotion MUST be repeatable for those clusters alone, without moving the tag again.

> [!NOTE]
> The tag is shared, so a cluster left behind serves a different render from the others until the promotion is repeated.

A promotion MUST NOT succeed until each Application it refreshed has either rendered or reported a render error.

A promotion MUST fail if any Application it refreshed reports a render error or a failed sync.

A promotion MUST fail if any Application it refreshed has neither rendered nor reported an error within a time limit, which is ten minutes unless the run sets another.

> [!NOTE]
> A promotion is the moment a renderer change takes effect on deployments, so the run that performs it is where a broken change is seen.
> The bar is a render that succeeds and a sync that has not failed, because a sync that runs migrations can outlast any reasonable wait for health.

## Access

A promotion MUST reach each cluster with a workload identity issued to the promotion run for that run, and MUST NOT use a stored credential.

That identity MUST be able to restart the Argo CD repo server, and to refresh Applications in the namespace of Argo CD.

That identity MUST NOT be able to create, change or delete an Application, or to act on anything else in the cluster.
