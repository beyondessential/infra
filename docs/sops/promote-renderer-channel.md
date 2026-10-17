# SOP: Promote a renderer channel

Move a renderer channel to a build that exists, and make every deployment on it render with that build.
**[dev-OTS]**: it changes the render of every deployment on the channel on every cluster, and it is a developer's call.
The requirements are in [K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#promotion).

## Canary

Every renderer build from `main` is promoted to `canary` by its own CD once its tests pass.
Nothing to run.

## Stable

Run the `infra-argo-tamanu-renderer promote` workflow (`.github/workflows/infra-argo-tamanu-renderer-promote.yml`) by hand with:

| Input | Value |
|---|---|
| `channel` | `stable` |
| `sha` | The commit of the build to promote, in full or at least seven characters. The build must already exist, because a promotion never builds. |
| `clusters` | Left at its default (`tamanu-internal-main shared-demos-demo`) unless repeating. |
| `retag` | On. |

The run moves the tag, restarts the Argo CD repo server of each cluster, waits, then hard-refreshes the awake Applications on that channel and waits for each to render.
It fails if any cluster was not reached, any Application reports a render error or a failed sync, or one has not rendered in ten minutes.
Promotions run one at a time.

## When a cluster was not reached

The failed run names the clusters it missed, and the tag has already moved, so those clusters serve a different render until repeated.
Run the workflow again with the same `channel` and `sha`, `clusters` set to the missed ones, and `retag` off.

## Trying a renderer change on one deployment

Give the deployment the `canary` channel and update it ([change a deployment's config](change-deployment-config.md), key `rendererChannel`, or Tamanu CD's `channel` option).
To go back, update again without it, and the Application is rendered by `stable` again without a refresh ([K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#channels)).
