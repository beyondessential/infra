# Tamanu renderer rollout

This spec covers how a change to the Tamanu renderer reaches the Tamanu
deployments that Argo CD renders with it. The renderer is the image Argo CD runs
as a plugin to turn a deployment's parameters into the Kubernetes objects of
that deployment. How a deployment is created and which channel it asks for is
the concern of Tamanu CD; this spec covers what the infrastructure does with
that choice.

A deployment is rendered by exactly one channel. `canary` receives every build
of the renderer and carries changes before they are trusted. `stable` receives
only builds that someone has chosen to trust. A change is tried by deployments
on `canary` first, and reaches the rest when `stable` moves.

## Channels

r[channel.tags]
The renderer image must be published under two channel tags, `canary` and
`stable`. Each tag names one build of the renderer at a time and moves when that
channel is promoted.

r[channel.default]
A deployment that names no channel is rendered by `stable`. A deployment is
rendered by `canary` only when its configuration says so.

r[channel.unknown]
A deployment that names any channel other than `canary` or `stable` must be
refused before anything changes, with a message that lists the accepted
channels. Accepting it would create an Application that names a plugin which
does not exist, and the deployment would sit in a render error.

r[channel.stable-continuity]
Applications created before channels existed must continue to be rendered by
`stable`, and must keep rendering, without being redeployed. Deployments are
long-lived and are not redeployed on any schedule the rollout controls.

r[channel.switch]
Changing a deployment's channel must cause it to be rendered by the other
channel the next time the deployment is applied, without a manual refresh. A
deployment that tried a change on `canary` and found it broken returns to
`stable` by being redeployed without the channel.

## Plugins

r[plugin.per-channel]
Each channel must run as its own Argo CD plugin, with a plugin name of its own,
registered by a sidecar of the Argo CD repo server. The name under which
`stable` registers is `infra-argo-tamanu-renderer-v1`, the name that existing
Applications refer to.

r[plugin.config-supplied]
A sidecar's plugin configuration must be supplied to it when it is deployed
rather than carried in the renderer image. Both channels run the same image, so
a configuration carried in it would register the same plugin name twice.

r[plugin.pull]
A sidecar must pull the renderer image at its channel's tag every time it
starts. A tag that moves is otherwise served from whatever the node last pulled.

## Parameters

r[params.channel-not-forwarded]
The setting that selects a deployment's channel belongs to the infrastructure
and must not be passed to the renderer. The renderer rejects parameters it does
not know, so a forwarded setting fails every render of the deployment.

r[params.per-channel-shape]
The parameters passed to a channel's renderer must be in the shape that
renderer accepts. While `stable` accepts an older shape than `canary`, the
parameters for a deployment on `stable` are converted to the older shape. This
lets a change to what the infrastructure passes be tried on `canary` before
`stable` is able to accept it.

r[params.channel-label]
An Application must carry its channel as a label, so that the Argo CD interface
can filter and group Applications by it.

## Promotion

r[promotion.from-build]
A channel tag must only move by promoting a renderer image that has already been
built and is identified by its commit. Promotion never rebuilds the renderer, so
what `stable` serves is the build that `canary` served.

r[promotion.canary]
Each build of the renderer from the main branch, once its tests pass, must be
promoted to `canary` automatically.

r[promotion.stable]
`stable` must move only when someone requests it, naming the commit to promote.

r[promotion.serialised]
Promotions must run one at a time. Both channels are served by one repo server,
so promotions that overlap restart it under each other.

r[promotion.restart]
After a channel tag moves, the promotion must restart the Argo CD repo server of
each cluster and wait for the restart to finish before it refreshes any
Application. A refresh answered by the old repo server stores the old render
again under the same cache key, and the Application keeps serving it.

r[promotion.refresh]
Once the repo server has restarted, the promotion must hard-refresh every
Application in the `tamanu` project that is rendered by the promoted channel's
plugin, so that each discards its cached render and renders again. An
Application rendered by the other channel must not be refreshed and keeps
serving its cached render.

r[promotion.clusters]
A promotion must apply to every cluster that runs Tamanu deployments.

r[promotion.partial]
A promotion that does not reach every cluster must fail and name the clusters it
did not reach. It must be possible to repeat it for those clusters alone,
without moving the tag again. The tag is shared, so a cluster left behind serves
a different render from the others until it is repeated.

r[promotion.outcome]
A promotion must not succeed until each Application it refreshed has either
rendered or reported an error, and must fail if any reports a render error or a
failed sync. A promotion is the moment a renderer change takes effect on
deployments, so the run that performs it is where a broken change is seen.

## Access

r[access.promotion-identity]
A promotion must reach each cluster with a workload identity issued to the
promotion run for that run, rather than a stored credential, and that identity
must be able to do two things only: restart the Argo CD repo server, and refresh
Applications in Argo CD's namespace. It must not be able to create, change or
delete an Application, or to act on anything else in the cluster.
