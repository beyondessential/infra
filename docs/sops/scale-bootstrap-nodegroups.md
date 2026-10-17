# SOP: Wind down or recall the bootstrap nodegroups

The bootstrap nodegroups are managed EKS nodegroups, always defined, that give Karpenter and the ingress components somewhere to run before Karpenter has provisioned its own nodes.
After bootstrap they stay at zero as a recovery handle: if Karpenter loses every node of a purpose, scale one back up.
Detail of what they are: [node pools reference](../reference/k8s-node-pools.md#bootstrap-nodegroups-and-placeholders).
Placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Scaling a nodegroup uses an AdminAccess profile, so a human runs it; an agent never initiates it.

## Why this is manual

Flipping `k8s-core:bootstrap` from `"true"` to `"false"` does nothing to nodegroups that exist: `pulumi/k8s-core/nodes/groups.ts` ignores changes to `scalingConfig.desiredSize`.
That is deliberate, and it is also why a manual scale-up during an incident survives a later `pulumi up`.

## Wind down after bootstrap

1. Confirm Karpenter has taken over. **[diagnose]**

   ```
   kubectl --context=<context> get nodes -L bes.node.group,bes.node.purpose
   ```

   Karpenter-provisioned nodes have a pool name in `BES.NODE.GROUP`, such as `system-arm`, `system-arm-spot` or `ingress-arm`.
   Bootstrap nodes show `bootstrap-system` or `bootstrap-ingress`.
   You need at least one Karpenter node of each purpose (`system` and `ingress`) before continuing.
   If there is no `ingress` node yet, wait: the `placeholder-ingress` Deployment, the load balancer controller and cert-manager being Pending are what make Karpenter provision one.
   If none appears, go to [nodes-not-provisioning](../runbooks/nodes-not-provisioning.md).

2. Find the nodegroup names. When `withLaunchTemplate` is `"false"` the code does not fix the names, so do not assume them. **[diagnose]**

   ```
   aws-sso exec -p <profile> -- aws eks list-nodegroups --cluster-name <cluster>
   ```

3. Scale each bootstrap nodegroup (two AZs times system and ingress) to zero. **[dev-OTS]**

   ```
   aws-sso exec -p <profile> -- aws eks update-nodegroup-config \
     --cluster-name <cluster> --nodegroup-name <nodegroup> \
     --scaling-config minSize=0,desiredSize=0,maxSize=1
   ```

   The console does the same under the cluster, Compute, Node groups, edit scaling configuration.
   AWS drains and terminates the instances; pods are rescheduled onto Karpenter nodes either way.

4. Remove the `k8s-core:bootstrap` key from the stack config ([bootstrap](bootstrap-k8s-cluster.md#7-wind-down)).

## Recall as a recovery handle

Use this when a purpose has no nodes and Karpenter cannot make one: for example no `system` node, so the controller cannot start, or no `ingress` node, so the Tailscale operator and the API server proxy are gone ([cluster-api-unreachable](../runbooks/cluster-api-unreachable.md)).

1. Reach the cluster directly if the tailnet is down ([connect-to-k8s-cluster](connect-to-k8s-cluster.md#directly-with-aws-sso)).
2. Scale one nodegroup of the missing purpose to one node (each nodegroup allows at most one). **[dev-OTS]**

   ```
   aws-sso exec -p <profile> -- aws eks update-nodegroup-config \
     --cluster-name <cluster> --nodegroup-name <nodegroup> \
     --scaling-config minSize=0,desiredSize=1,maxSize=1
   ```

3. Fix the underlying problem, then scale it back to zero with the wind-down command. **[dev-OTS]**

Bootstrap nodes carry `bes.node.purpose`, `bes.node.arch`, `bes.node.schedule=ondemand` and `karpenter.sh/capacity-type=on-demand`, so the components with a required purpose affinity can schedule on them.
