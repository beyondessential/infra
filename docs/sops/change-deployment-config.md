# SOP: Change a deployment's config and update it

Change a stack config key and update the deployment, for example to raise `ttlHours`, change `imageTag`, or try the `canary` renderer.
**[dev-OTS]**: an update changes the live deployment, and a config change can be a ruled-out one ([the pruning case](../ruled-out-actions.md#ruled-out-actions-never-suggest)).
Read the key in the [config reference](../reference/tamanu-deployment-config.md) first.

Every `pulumi up` also sets a new expiry on a deployment with a time to live and wakes it ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#time-to-live)).

1. Connect `kubectl` to the deployment's cluster ([connect to the cluster](connect-to-k8s-cluster.md)).
2. Pull the stack's config first ([pull stack config](refresh-stack-config.md); for every Tamanu stack, `pulumi/scripts/refreshConfigs.fish tamanu/on-k8s`).
   CI deploys change `imageTag` and other keys in the backend, and an update from a stale local file rolls the environment back to the tag it last saw.

3. Set the key, from `pulumi/tamanu/on-k8s`.
   Never set a secret here, because the stub refuses it:

   ```sh
   pulumi config set -s <stack> ttlHours 24
   ```

4. Preview with the guardrail pack built first.
   Only the `tamanu-application` resource should change for a config key the renderer handles:

   ```sh
   npm run build --prefix pulumi/policies
   pulumi preview -s <stack> --diff --policy-pack pulumi/policies
   ```

5. Update:

   ```sh
   pulumi up -s <stack> --policy-pack pulumi/policies
   ```

   The update waits for the Application to be Synced and Healthy and fails after `argoWaitMinutes` (30 by default) or when a sync fails ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#update-completion)).
   If it fails, go to [sync failed or stuck progressing](../runbooks/application-stuck-progressing.md).
6. Check the [Application](inspect-application.md).

## Many stacks at once

`pulumi/scripts/tamanuStacks.fish` previews, updates or destroys stacks across both clusters (see its header for usage).
`--up` refreshes config and builds the policy pack first, runs each update under a 45 minute timeout, and skips stacks that are hibernated (an update would wake them) or whose database has no ready instance.
Read the script before running it.
