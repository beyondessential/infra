# Bootstrapping a new Kubernetes cluster

End-to-end walkthrough for standing up a new cluster from a fresh AWS account up to a fully running k8s-essentials install. Two Pulumi stacks need to come up in order: `k8s-core` (the EKS control plane and AWS-side infrastructure) and `k8s-essentials` (the cluster-internal services that run on top).

Bootstrap is also the only time `k8s-essentials` needs direct AWS credentials. Once the Tailscale operator is up, all further `pulumi up` and `kubectl` work goes through the Tailscale API-server proxy.

For day-to-day architecture, see [kubernetes.md](./kubernetes.md). This doc only covers initial setup.

## 0. Inputs

You'll need:

- An AWS account with admin access and an aws-sso profile for it. The conventional name is `_<Account>:AdminAccess` (e.g. `_Shared_Demos:AdminAccess`, `_Internal_Tamanu:AdminAccess`).
- A core stack already in place (`pulumi/core/Pulumi.<account>.yaml`). If not, set that up first — it provides the VPC, subnets, Route 53 zones, and tags the k8s stacks read via the cross-stack ref.
- A Tailscale tailnet admin login. You'll create an OAuth client during k8s-essentials bring-up.
- A stack name for the cluster. By convention: `<account>-<cluster>`. Examples:
  - account `shared-demos`, cluster `demo` → stack `shared-demos-demo`
  - account `tamanu-internal`, cluster `main` → stack `tamanu-internal-main`

Throughout this doc, replace:

- `<stack>` with your full stack name (e.g. `shared-demos-demo`)
- `<cluster>` with the EKS cluster name, which is the same as the stack name
- `<context>` with the kubeconfig context name you want (the stack config's `kubernetes:context`, e.g. `demo` or `main`)
- `<profile>` with your aws-sso admin profile (e.g. `_Shared_Demos:AdminAccess`)

## 1. k8s-core: cluster, control plane, AWS-side services

### 1.1 Create the stack config

`pulumi/k8s-core/Pulumi.<stack>.yaml`. Minimum:

```yaml
config:
  aws:region: ap-southeast-2
  awsx:region: ap-southeast-2
  aws-native:region: ap-southeast-2
  pulumi:disable-default-providers:
    - kubernetes
  k8s-core:core: bes/core/<account>
  k8s-core:version: "1.35"
  k8s-core:externalDnsZones:
    your.zone.example: ZZZZZZZZZZZZZZZZZZZ
  k8s-core:useKarpenter: "true"
  k8s-core:bootstrap: "true"
  k8s-core:envoyGatewayEnabled: "true"
  k8s-core:withLaunchTemplate: "false"
```

The flags that matter on first bring-up:

- `bootstrap: "true"` — seeds the cluster with managed nodegroups so Karpenter has somewhere to run while it's coming up. Two purposes are seeded (`system`, `ingress`), two AZs each, on-demand burstable instances. After bring-up these are kept at `desired: 0` as a recovery handle; the flag controls only the initial scale.
- `useKarpenter: "true"` — installs the Karpenter controller and NodePools alongside the bootstrap nodegroups.
- `envoyGatewayEnabled: "true"` — gate for cert-manager's Gateway API integration; matches what k8s-essentials sets.

Other knobs (`enableAwsLb`, `enableCertManager`, `enableExternalDns`, etc.) all default to `true`. See [kubernetes.md §1.2](./kubernetes.md) for the full list.

### 1.2 Run pulumi up

```bash
cd pulumi/k8s-core
pulumi stack select <stack>      # `pulumi stack init <stack>` if new
aws-sso exec -p <profile> -- pulumi preview
aws-sso exec -p <profile> -- pulumi up
```

This takes ~15 minutes. Once done you have an EKS cluster, the Karpenter controller running on a bootstrap-system node, LBC and cert-manager pending on a bootstrap-ingress node, and the rest of the foundation in place.

### 1.3 Verify

You can't talk to the cluster yet (kubeconfig comes next, in part 2 of bootstrap), but you can check the AWS side:

```bash
aws-sso exec -p <profile> -- aws eks describe-cluster --name <cluster> --query 'cluster.status'
# "ACTIVE"
```

## 2. Tailscale ACL: register the cluster's tags

The Tailscale operator and proxies enrol themselves as tagged devices. Those tags must exist in the tailnet's ACL policy before the OAuth client can grant them. Skipping this step means the OAuth client creation in §3.1 fails with `tag not allowed`, or — worse — succeeds but the operator can't enrol devices on first `pulumi up`.

Tailscale ACL policy lives in <https://github.com/beyondessential/tailscale>. Open a PR there that adds three new tag definitions for this cluster, plus any grants the proxy tag needs in the ACL.

### 2.1 Naming convention

For a cluster called `<cluster>`, define:

| Tag | Used by | Mapped to in pulumi |
|---|---|---|
| `tag:k8s-<cluster>` | General cluster device tag (proxies inherit it) | `tailscaleProxyDefaultTags[0]` |
| `tag:k8s-<cluster>-proxy` | Per-Service Tailscale proxy devices | `tailscaleProxyDefaultTags[1]` |
| `tag:k8s-<cluster>-operator` | The Tailscale operator device itself | `tailscaleOperatorDefaultTags[0]` |

Existing examples to copy: `tag:k8s-demo*` (shared-demos cluster), `tag:k8s-data*` (data cluster). `tamanu-internal-main` uses the unqualified defaults (`tag:k8s`, `tag:k8s-proxy`, `tag:k8s-operator`) for historical reasons; don't follow that pattern on new clusters.

### 2.2 What the ACL PR needs

- **Tag owners** for each of the three new tags. Use the same group as existing `tag:k8s*` entries (typically `group:k8s-admins` or whoever owns cluster operations).
- **ACL grants** so the proxy tag can be reached from the relevant tailnet identities. The k8s-operator's API-server proxy is reachable by anyone with a grant to its operator tag; the per-Service proxies are reachable by whoever you grant the proxy tag to. Mirror what the existing cluster you're modelling on does.
- **DNS / search domains** rarely need anything — Tailscale MagicDNS resolves `<device>.tail<tailnet>.ts.net` automatically.

Get the PR merged and the policy applied (the tailscale repo's CI / release process handles this) before continuing. Verify in the admin UI that the new tags appear under <https://login.tailscale.com/admin/acls/file>.

## 3. k8s-essentials: cluster-internal services

### 3.1 Create a Tailscale workload identity federation credential

The k8s-essentials Tailscale module authenticates to the Tailscale API by exchanging an OIDC token minted by the cluster's own OIDC issuer (the same one we already use for IRSA). No long-lived client secret is stored anywhere — `tailscale.ts` keys off whichever set of config values is present.

First, grab the cluster's OIDC issuer URL:

```bash
aws-sso exec -p <profile> -- aws eks describe-cluster --name <cluster> \
  --query 'cluster.identity.oidc.issuer' --output text
# https://oidc.eks.ap-southeast-2.amazonaws.com/id/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Then in the Tailscale admin: <https://login.tailscale.com/admin/settings/oauth> → "Add OIDC" → **Custom issuer**.

- **Issuer**: paste the URL from above
- **Subject**: `system:serviceaccount:tailscale-system:operator` (matches the SA the operator chart creates)
- **Scopes**: `Devices Core` (write), `Auth Keys` (write), `Services` (write). These three are what the operator chart needs for full functionality — node enrolment, ingress/egress proxies, the API-server proxy, and the Tailscale Services feature ([per the Kubernetes operator docs](https://tailscale.com/kb/1236/kubernetes-operator)).
- **Tags**: `tag:k8s-<cluster>-operator` (the one you defined in §2.1)

Save. Tailscale gives you a **Client ID** and **Audience** value. Both are non-secret — the security comes from Tailscale validating the OIDC token's signature against the cluster's issuer at exchange time.

> **Migrating an existing cluster?** The static OAuth client path still works. Generate a client at the same admin URL with the same three scopes (`devices:core:write`, `auth_keys:write`, `services:write`), keep using `tailscaleClientSecret` in the stack config, skip the OIDC issuer setup. Per-cluster migration is a flag flip — set `tailscaleAudience`, unset `tailscaleClientSecret`, `pulumi up`, then delete the OAuth client in the Tailscale admin.

### 3.2 Create the stack config

`pulumi/k8s-essentials/Pulumi.<stack>.yaml`:

```yaml
config:
  kubernetes:context: <context>
  # uncomment after the Tailscale operator is up (see §3.7):
  #kubernetes:cluster: k8s-operator-<cluster>.tail53aef.ts.net
  k8s-essentials:k8s-core: bes/k8s-core/<stack>
  k8s-essentials:hncEnabled: "true"
  k8s-essentials:tailscaleEnabled: "true"
  k8s-essentials:tailscaleClientId: <client-id-from-§3.1>
  k8s-essentials:tailscaleAudience: <audience-from-§3.1>
  k8s-essentials:tailscaleOperatorDefaultTags:
    - tag:k8s-<cluster>-operator
  k8s-essentials:tailscaleProxyDefaultTags:
    - tag:k8s-<cluster>
    - tag:k8s-<cluster>-proxy
  k8s-essentials:nginxEnabled: "false"
  k8s-essentials:downscalerEnabled: "true"
```

No secret config needed — the OIDC token exchange replaces the stored client secret.

### 3.3 Get a kubeconfig pointed at the EKS API directly

The Tailscale proxy isn't up yet — that's what we're about to install — so the first `pulumi up` has to go through the EKS public endpoint with AWS auth.

```bash
aws-sso exec -p <profile> -- aws eks update-kubeconfig --name <cluster> --alias <context>
```

The `--alias <context>` makes the context name match what `kubernetes:context` in the stack config expects.

### 3.4 Wrap kubeconfig auth through aws-sso

`aws eks update-kubeconfig` writes a `users:` entry whose `exec.command` is plain `aws`. That'll fail because there are no live AWS creds for that user outside of an aws-sso session. Wrap it.

Open `~/.kube/config`, find the new user entry (its name is `arn:aws:eks:…cluster/<cluster>`), and change:

```yaml
- name: arn:aws:eks:ap-southeast-2:…:cluster/<cluster>
  user:
    exec:
      command: aws
      args:
        - --region
        - ap-southeast-2
        - eks
        - get-token
        - …
```

to:

```yaml
- name: arn:aws:eks:ap-southeast-2:…:cluster/<cluster>
  user:
    exec:
      command: aws-sso
      args:
        - exec
        - -p
        - <profile>
        - "--"
        - aws
        - --region
        - ap-southeast-2
        - eks
        - get-token
        - …
```

(Same trailing args; just `aws-sso exec -p <profile> --` prepended and `command:` changed from `aws` to `aws-sso`.)

Test:

```bash
kubectl --context=<context> cluster-info
```

You should see the EKS API endpoint URL plus CoreDNS. If it hangs or 401s, the wrapping is wrong.

### 3.5 Comment out the CNPG image catalogs

In `pulumi/k8s-essentials/postgres/cnpg.ts`, comment out the two `ConfigFile` resources at the bottom of the file:

```typescript
// new k8s.yaml.v2.ConfigFile('catalog-postgres', { … });
// new k8s.yaml.v2.ConfigFile('catalog-postgis', { … });
```

These reference the `ClusterImageCatalog` CRD installed by CNPG earlier in the same file. On the first run, Pulumi can't see the CRD yet and trips trying to validate the `ConfigFile` objects.

### 3.6 First pulumi up

```bash
pulumi preview
pulumi up
```

Watch for the `tailscale-operator` Helm release — that's the one whose success unblocks the next step. Roughly 5–10 minutes.

Once it's done you'll have:

- The Tailscale operator registering a device named `k8s-operator-<cluster>` (visible at <https://login.tailscale.com/admin/machines>)
- Prometheus, OpenCost, HNC, CNPG (without catalogs), team RBAC roles, downscaler all live
- An NLB fronting the Envoy proxy fleet (if envoy is on) or the NGINX ingress (if nginx is on)

### 3.7 Switch the kubeconfig to the Tailscale endpoint

Once `k8s-operator-<cluster>` is visible and healthy in the Tailscale admin:

```bash
kubectl config set-cluster <cluster> --server=https://k8s-operator-<cluster>.tail53aef.ts.net
```

Then uncomment the `kubernetes:cluster` line in `Pulumi.<stack>.yaml` so future `pulumi up`s pin to it too:

```yaml
  kubernetes:cluster: k8s-operator-<cluster>.tail53aef.ts.net
```

`failIfIncorrectCluster()` in `common/k8s/coreRef.ts` accepts either the direct EKS endpoint or the matching `k8s-operator-<cluster>.tail53aef.ts.net` form, so you can flip without breaking anything in progress.

From here on, no further aws-sso interaction is needed for cluster work — the Tailscale operator proxy authenticates you against the EKS API using your tailnet identity.

### 3.8 Restore the catalogs and reconcile

Revert the comment-outs in `postgres/cnpg.ts`, then:

```bash
pulumi up
```

This applies the two `ClusterImageCatalog` resources (now that the CRD exists) and confirms everything else is in steady state.

## 4. Verification

```bash
kubectl --context=<context> get pods -A
```

A healthy cluster has:

- `kube-system`: vpc-cni, kube-proxy, coredns, aws-load-balancer-controller (2× ingress), aws-node-monitoring, karpenter (2× system), ebs-csi (2× system + DaemonSet)
- `cert-manager`: cert-manager (2× ingress) + webhook + cainjector
- `envoy-gateway-system`: 2× ingress (if envoy enabled)
- `tailscale-system`: 1× operator on ingress
- `metrics-system`: prometheus-server, opencost
- `cnpg-system`: cnpg-controller-manager
- `hnc-system`: hnc-controller-manager, hnc-webhooks (2×) (if hncEnabled)

Karpenter NodePool status:

```bash
kubectl --context=<context> get nodepools
kubectl --context=<context> get ec2nodeclasses
```

All NodeClasses should show `Ready=True`, `SubnetsReady=True`, `SecurityGroupsReady=True`. NodePools should show `Ready=True`.

### 4.1 Troubleshooting: NodeClasses stuck "Not Ready"

If `get ec2nodeclasses` shows an empty `READY` column (no `True`/`False`) and stays that way, the Karpenter controller isn't running — it can't reconcile, so the NodeClass status never gets written. Check:

```bash
kubectl --context=<context> -n kube-system get pods -l app.kubernetes.io/name=karpenter
```

If the pods are `Pending`, `kubectl describe` will show the scheduling failure. The classic bootstrap-time cause is a missing `karpenter.sh/capacity-type` label on the bootstrap nodes — Karpenter's controller has a `DoNotSchedule` topology spread on that key, and the chart writes the label only on nodes Karpenter itself provisioned. The bootstrap managed nodegroups need it set in their nodegroup `labels` block.

Quick unblock (replace `<node>` with the bootstrap-system node's name from `kubectl get nodes`):

```bash
kubectl --context=<context> label node <node> karpenter.sh/capacity-type=on-demand
```

One Karpenter replica schedules onto the newly-labelled node; it starts, provisions a system-arm-spot node from its own NodePool, and the second replica schedules onto that. NodeClasses flip to `Ready` within a minute or two. The fix is permanent in `pulumi/k8s-core/nodes/groups.ts`, but it doesn't help nodes that came up before the label was added.

### 4.2 Troubleshooting: NodeClasses stuck "Unknown" with InstanceProfile errors

If `get ec2nodeclasses` shows `Unknown` in the `READY` column (not empty — Karpenter *is* running and writing status), inspect the conditions:

```bash
kubectl --context=<context> get ec2nodeclass workload \
  -o jsonpath='{.status.conditions}' | jq
```

If you see `InstanceProfileReady=Unknown` with `"object is awaiting reconciliation"` and `ValidationSucceeded=Unknown` with `"Awaiting AMI, Instance Profile, Security Group, and Subnet resolution"` — even though everything else (AMIs, Subnets, SecurityGroups) is `True` — the controller is failing to create the InstanceProfile in IAM. Confirm by tailing Karpenter logs:

```bash
kubectl --context=<context> -n kube-system logs -l app.kubernetes.io/name=karpenter --tail=80 \
  | grep -iE 'instanceprofile|ValidationError'
```

Look for `CreateInstanceProfile` with a `ValidationError` about a tag value not matching `[\p{L}\p{Z}\p{N}_.:/=+\-@]*`. Karpenter propagates `EC2NodeClass.spec.tags` onto the InstanceProfile it creates, and IAM tag values are stricter than EC2 tag values — no `[`, `]`, `(`, `)`, `{`, `}`, `,`, `;`, quotes, etc. The standard offender is the `Name` tag if it carries brackets; the fix is in `pulumi/k8s-core/karpenter/classes.ts` where `namePrefix` and `tags` are set. Run `pulumi up` after fixing, Karpenter re-reconciles within a few seconds, NodeClasses flip to `Ready`.

## 5. Wind down the bootstrap nodegroups

Once Karpenter has provisioned its own system and ingress nodes and workloads have migrated onto them, scale the bootstrap nodegroups down to `desired: 0`. They stay defined (as a recovery handle — see §6) but stop running EC2 instances.

This isn't automated and flipping `k8s-core:bootstrap: "true" → "false"` is a no-op against existing nodegroups: `pulumi/k8s-core/nodes/groups.ts` sets `ignoreChanges: ['scalingConfig.desiredSize']` so Pulumi never touches that property after creation. That's deliberate — it's also what makes manual scale-ups during incident recovery survive a later `pulumi up` — but it means winding down is a manual step.

### 5.1 Confirm Karpenter has taken over

```bash
kubectl --context=<context> get nodes -L bes.node.group,bes.node.purpose
```

Look for nodes whose `BES.NODE.GROUP` is something like `system-arm`, `system-arm-spot`, or `ingress-arm` — those are Karpenter-provisioned. Bootstrap nodes are `bootstrap-system-az1`/`bootstrap-system-az2`/`bootstrap-ingress-az1`/`bootstrap-ingress-az2`. You want at least one Karpenter-provisioned node of each purpose Karpenter manages (system + ingress) before continuing. If Karpenter hasn't provisioned an ingress node yet, give it a few minutes — LBC and cert-manager pending should be what triggers it.

### 5.2 Scale each bootstrap nodegroup to zero

Four nodegroups (two AZs × system + ingress). Either from the AWS console (EKS → cluster → Compute → Node groups → edit scaling config) or:

```bash
for ng in bootstrap-system-az1 bootstrap-system-az2 bootstrap-ingress-az1 bootstrap-ingress-az2; do
  aws-sso exec -p <profile> -- aws eks update-nodegroup-config \
    --cluster-name <cluster> --nodegroup-name "$ng" \
    --scaling-config minSize=0,desiredSize=0,maxSize=1
done
```

AWS drains and terminates the bootstrap instances. Pods running on them get evicted; Karpenter sees them pending and reschedules onto its own nodes (or onto the now-empty bootstrap node before AWS terminates it, depending on timing — same end state either way).

### 5.3 Tidy the stack config

The `k8s-core:bootstrap: "true"` line in `Pulumi.<stack>.yaml` is now misleading — its only effect was on initial `desiredSize`, which is locked in. Remove the line (or flip to `"false"`) so future readers aren't confused. No `pulumi up` needed; the change is purely cosmetic.

```bash
cd pulumi/k8s-core
pulumi stack select <stack>
pulumi config rm k8s-core:bootstrap
```

## 6. Day-to-day handoff

After bootstrap, the only stack that ever needs AWS credentials is `k8s-core`. Both Pulumi `up`s on `k8s-essentials` and ad-hoc `kubectl` calls go through Tailscale. See [kubernetes.md §4](./kubernetes.md) for the normal-operation kubeconfig.

The bootstrap nodegroups stay defined at `desired: 0` — they're a recovery handle if Karpenter ever wedges (drops every ingress node, etc.). Scale up via the AWS console (same UI as §5.2) to get a node back, fix the underlying issue, scale back to 0. See `pulumi/k8s-core/nodes/groups.ts` for the rationale.
