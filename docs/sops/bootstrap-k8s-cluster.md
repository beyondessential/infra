# SOP: Bootstrap a new Kubernetes cluster

Stands up a cluster from a prepared AWS account to a running `k8s-essentials` install, in two stacks that must come up in order: `k8s-core` (EKS and the AWS side) then `k8s-essentials` (in-cluster services).
Bootstrap is the only time `k8s-essentials` needs AWS credentials: once the Tailscale operator is up, `pulumi up` and `kubectl` go over the tailnet.
Requirements: [K8SNSP](../spec/kubernetes/namespaces.md#cluster-endpoint-access), [K8SNOD](../spec/kubernetes/nodes.md).
Placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Every `pulumi up` below is **[dev-OTS]**, and a human runs it: it needs an AdminAccess profile, which an agent never initiates.
A preview is **[diagnose]**; run it as `pulumi preview --policy-pack <repo>/pulumi/policies` after `npm run build` in `pulumi/policies` ([GRD](../spec/policies/guardrails.md#application-to-stacks)).

## Before you start

- The account's core stack is deployed with `core:forEksCluster: true` (private subnets, NAT subnets, the EKS CNI IPv6 policy) and publishes `spotDataFeed`.
- You have the aws-sso AdminAccess profile for the account, and Tailscale admin access.
- You have chosen `<account>` and `<cluster>`; the stack is `<account>-<cluster>`.
- Pull any existing config ([refresh-stack-config](refresh-stack-config.md)).

## 1. k8s-core

1. Create `pulumi/k8s-core/Pulumi.<stack>.yaml` with the shape in the [k8s-core config reference](../reference/k8s-core-config.md#shape). Set with `pulumi config set`. **[dev-OTS]**

   The three flags that matter on first bring-up: `bootstrap: "true"` (the bootstrap nodegroups start at one node each so Karpenter has somewhere to run), `useKarpenter: "true"`, `envoyGatewayEnabled: "true"`.
   Set `tailscaleProxyDefaultTags` here, in k8s-core: k8s-essentials reads the proxy tags from this stack.

2. Preview, then apply. **[diagnose]** then **[dev-OTS]**

   ```
   cd pulumi/k8s-core
   pulumi stack select <stack>      # pulumi stack init <stack> if new
   aws-sso exec -p <profile> -- pulumi preview --policy-pack ../policies
   aws-sso exec -p <profile> -- pulumi up --policy-pack ../policies
   ```

3. Check the control plane. **[diagnose]**

   ```
   aws-sso exec -p <profile> -- aws eks describe-cluster --name <cluster> --query 'cluster.status'
   ```

   Expect `"ACTIVE"`. The Karpenter controller runs on a bootstrap-system node; the load balancer controller and cert-manager schedule on a bootstrap-ingress node. If `envoyGatewayEnabled` is true, cert-manager checks for the Gateway API CRDs at startup and the code comment says it crash-loops without them; k8s-essentials installs them in step 3 (`pulumi/k8s-core/cert-manager/controller.ts`).

## 2. Tailscale

Define the tags and create the operator identity: [register-cluster-in-tailscale](register-cluster-in-tailscale.md).
You need its client id and audience for the next step.

## 3. k8s-essentials

1. Create `pulumi/k8s-essentials/Pulumi.<stack>.yaml` with the shape in the [k8s-essentials config reference](../reference/k8s-essentials-config.md#shape). **[dev-OTS]**

2. Get a direct kubeconfig, because the Tailscale proxy does not exist yet: [connect-to-k8s-cluster](connect-to-k8s-cluster.md#directly-with-aws-sso). Check `kubectl --context=<context> cluster-info`.

3. Comment out the two CNPG image catalogs. In `pulumi/k8s-essentials/postgres/cnpg.ts`, comment out the `ConfigFile` resources `catalog-postgres` and `catalog-postgis`. They reference a CRD the same file installs, which Pulumi cannot see on the first run. Do not commit this edit. **[dev-OTS]**

4. Apply. **[diagnose]** then **[dev-OTS]**

   ```
   cd pulumi/k8s-essentials
   pulumi stack select <stack>
   pulumi preview --policy-pack ../policies
   pulumi up --policy-pack ../policies
   ```

   Watch the `tailscale` Helm release: its success unblocks the next step. Afterwards the operator registers a device `k8s-operator-<stack>` in the Tailscale admin machines list.

## 4. Move to the tailnet

1. Once the device is healthy, point the kubeconfig cluster entry at its host: **[dev-OTS]**

   ```
   kubectl config set-cluster <cluster> --server=https://k8s-operator-<stack>.<tailnet-domain>
   ```

   Then confirm the context you will use points at the tailnet host and does not still exec `aws-sso` (`kubectl config view --minify`, **[sensitive-data]**, redact before sharing).
   If it does, use the tailnet context from [connect-to-k8s-cluster](connect-to-k8s-cluster.md#over-the-tailnet) instead.

2. Add `kubernetes:cluster: <the tailnet cluster entry name in your kubeconfig>` to the k8s-essentials stack config so later runs pin to it. `failIfIncorrectCluster()` accepts either the direct endpoint or the matching tailnet host, so switching mid-way breaks nothing.

From here no AWS credentials are needed except to change `k8s-core`.

## 5. Restore the catalogs

Revert the comment-out in `cnpg.ts` and apply again over the tailnet. **[dev-OTS]**
This applies the two `ClusterImageCatalog` resources now that the CRD exists, and confirms everything else is in steady state.

## 6. Verify

```
kubectl --context=<context> get pods -A
kubectl --context=<context> get nodepools
kubectl --context=<context> get ec2nodeclasses
```

**[diagnose]** Expect running pods in the namespaces listed under [component ownership](../reference/k8s-what-lives-where.md#component-ownership) for the features you enabled, every NodeClass `Ready=True` (with `SubnetsReady` and `SecurityGroupsReady` true), and every NodePool `Ready=True`.
An empty or `Unknown` NodeClass: [karpenter-nodeclass-not-ready](../runbooks/karpenter-nodeclass-not-ready.md).

## 7. Wind down

When Karpenter has provisioned its own system and ingress nodes: [scale-bootstrap-nodegroups](scale-bootstrap-nodegroups.md).
Then remove the now-misleading flag: `pulumi config rm k8s-core:bootstrap` with the `k8s-core` stack selected. **[dev-OTS]** No `up` is needed.
