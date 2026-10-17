# Reference: k8s-essentials stack config

Top-level config of `pulumi/k8s-essentials`, under the `k8s-essentials:` namespace, plus the Kubernetes provider keys.
The authority is the code: `rg 'cfg\.(get|require)' pulumi/k8s-essentials pulumi/common/k8s`.

## Keys

| key | default | effect | read in |
|---|---|---|---|
| `k8s-core` | required | Cross-stack reference, `bes/k8s-core/<stack>`. | `common/k8s/coreRef.ts` |
| `kubernetes:context` | none | Kubeconfig context the Pulumi provider uses. | provider config |
| `kubernetes:cluster` | none | Kubeconfig cluster entry the provider pins to. After bootstrap it names the tailnet cluster entry. | provider config |
| `tailscaleEnabled` | `false` | Installs the Tailscale operator with its API server proxy. Nothing else in this table that starts `tailscale` has any effect while it is `false`. | `tailscale.ts` |
| `tailscaleClientId` | required when enabled | OAuth client id. Not secret. | `tailscale.ts` |
| `tailscaleAudience` | unset | Audience of the federated identity; the operator exchanges an OIDC token from the cluster's issuer, so no secret is stored. | `tailscale.ts` |
| `tailscaleClientSecret` | unset | Secret. Static OAuth credential kept by older clusters; it wins when both it and `tailscaleAudience` are set. | `tailscale.ts` |
| `tailscaleOperatorDefaultTags` | `[tag:k8s-operator]` | Tags on the operator device. | `tailscale.ts` |
| `tailscaleExitNodeName` | unset | Adds a `Connector` exit node of that name (tagged `tag:server`) on the `tailscale-exit` node pool. A rename in the stack needs the machine renamed back to generated in the Tailscale admin console (comment in `tailscale.ts`). | `tailscale.ts` |
| `nginxEnabled` | `true` | NGINX ingress in `ingress-system`. | `index.ts` |
| `postgresEnabled` | `true` | CloudNativePG, the Barman Cloud plugin and the image catalogs. | `index.ts` |
| `hncEnabled` | `true` | HNC CRDs, roles, manager and webhooks. | `index.ts` |
| `downscalerEnabled` | `true` | py-kube-downscaler ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#cluster-downscaler)). | `index.ts` |
| `argoEnabled` | `false` | Argo CD in `argocd-system`, behind a Tailscale Ingress. | `index.ts` |
| `argoVersion` | the pinned chart | Installs another Argo CD chart version. | `argo/index.ts` |
| `argoNamespace` | `argocd-system` | Namespace of Argo CD. Each stack reads its own copy, so set it in every stack that uses Argo CD, including `tamanu/k8s-infra`. | `common/k8s/argo.ts` |
| `argoTailscaleName` | `argocd-<stack>` | Tailnet hostname of the Argo CD UI. | `argo/index.ts` |

Envoy Gateway has no key here: `envoyGatewayEnabled` in the [k8s-core config](k8s-core-config.md) decides it.
The proxy tags (`tailscaleProxyDefaultTags`) also come from k8s-core.
Always installed: Prometheus, OpenCost, the engineer `view` binding on `metrics-system`, the Tailscale module (inert unless enabled), and the `oncall` and `data-engineer` roles.
PGRO, the restore operator, is not part of this stack (`pulumi/data/pgro`).

## Shape

Bootstrap shape; values in angle brackets are per cluster.
The Tailscale credential values come from [Tailscale registration](../sops/register-cluster-in-tailscale.md); neither is secret.

```yaml
config:
  kubernetes:context: <context>
  # added once the operator is up, see the bootstrap procedure:
  #kubernetes:cluster: <tailnet cluster entry in kubeconfig>
  k8s-essentials:k8s-core: bes/k8s-core/<stack>
  k8s-essentials:hncEnabled: "true"
  k8s-essentials:tailscaleEnabled: "true"
  k8s-essentials:tailscaleClientId: <client id>
  k8s-essentials:tailscaleAudience: <audience>
  k8s-essentials:tailscaleOperatorDefaultTags:
    - tag:k8s-<cluster>-operator
  k8s-essentials:nginxEnabled: "false"
  k8s-essentials:downscalerEnabled: "true"
```

Set secrets, where a stack still has them, with `pulumi config set --secret`.
