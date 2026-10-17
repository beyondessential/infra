# SOP: Create a deployment

Bring up a Tamanu deployment on Kubernetes.
**[dev-OTS]**: it creates a namespace, databases and public addresses.
The stub, the renderer and Argo CD do the work, and there is no per-deployment code ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#application)).
Read the script or workflow you run before running it.

## From a pull request or branch (the usual route)

Tamanu CD creates and updates the deployment when a deploy box in a pull request body, or an auto-deploy issue, is ticked.
Options go after `%` on that line.
CD then, in order ([`cd-up.yml`](https://github.com/beyondessential/tamanu/blob/main/.github/workflows/cd-up.yml) in the Tamanu repository):

1. Creates the SubnamespaceAnchor `tamanu-<name>` in `tamanu-super` if absent, so HNC creates the namespace.
2. Records `repo`, `ref`, `control` and `imageTag` in a ConfigMap `auto-deploy` in it.
3. Writes the stack config (`externalNamespace: true`, `imageTag`, `appVersion` and the rest from the options, see `configMap()` in `packages/scripts/src/ghaCdHelpers.mjs`) into the stack `bes/tamanu-on-k8s/<name>`.
4. Runs `pulumi up` from the ops ref, which the `%opsref` option can change.

The options and their defaults are Tamanu CD's, so read them there.
The result is Argo CD applying the render, and the update fails if the Application is not Synced and Healthy within `argoWaitMinutes` ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#update-completion)).

## By hand (a long-lived deployment)

1. Pick the stack name.
   The namespace is `tamanu-` plus its normalised form ([deployment context](../deployment-context.md#names)).
2. Connect `kubectl` to the cluster ([connect to the cluster](connect-to-k8s-cluster.md)).
   The program refuses to run against a different cluster from its `k8s-core`.
3. Choose who owns the namespace.
   With `externalNamespace: false` the stack creates it and parents it to `tamanu-super`.
   With `true`, create the anchor first and wait for it to be ready:

   ```sh
   kubectl apply -f - <<YAML
   apiVersion: hnc.x-k8s.io/v1alpha2
   kind: SubnamespaceAnchor
   metadata:
     name: tamanu-<name>
     namespace: tamanu-super
   YAML
   kubectl -n tamanu-super wait --for=condition=Ready subnamespaceanchor/tamanu-<name>
   ```

   Deleting the anchor later deletes the namespace and everything in it ([K8SNSP](../spec/kubernetes/namespaces.md#deployment-namespaces), [HNC](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/how-to.md#delete-a-subnamespace)).
4. From `pulumi/tamanu/on-k8s`, create the stack and set its config ([config reference](../reference/tamanu-deployment-config.md)).
   `k8s-core` and `imageTag` are required.
   Stack config files are gitignored ([pull stack config](refresh-stack-config.md)), and values go in with `pulumi config set`, never as secrets:

   ```sh
   pulumi stack init bes/tamanu-on-k8s/<name>
   pulumi config set k8s-core bes/k8s-core/<cluster-stack>
   pulumi config set imageTag <tag>
   pulumi config set externalNamespace true
   ```

5. Preview with the guardrail pack built first, read the diff, then update:

   ```sh
   npm run build --prefix pulumi/policies
   pulumi preview --policy-pack pulumi/policies
   pulumi up --policy-pack pulumi/policies
   ```

6. Check the result: [inspect the Application](inspect-application.md) and the addresses in the stack's `urls` output.

A new database starts empty unless `seedSnapshot` is set ([seeded deployments](../runbooks/seeded-deployment.md)).
A stack deployed by the previous Pulumi program is refused until it is handed over ([stub refuses](../runbooks/stub-refuses-update.md)).
