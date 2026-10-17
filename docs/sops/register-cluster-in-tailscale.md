# SOP: Register a cluster's tags and operator identity in Tailscale

A new cluster needs its tags defined in the tailnet policy, and a federated identity that lets the Tailscale operator talk to the Tailscale API.
Do both before the first `k8s-essentials` apply ([bootstrap](bootstrap-k8s-cluster.md)).
Requirements: [Tailscale operator](../spec/kubernetes/namespaces.md#tailscale-operator).
Placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.

## 1. Tags in the tailnet policy

The policy lives in `beyondessential/tailscale`, outside this repository.
Open a pull request there that defines, for a cluster `<cluster>`:

| tag | used by | set in |
|---|---|---|
| `tag:k8s-<cluster>` | the cluster's proxy devices (first proxy tag) | `k8s-core:tailscaleProxyDefaultTags[0]` |
| `tag:k8s-<cluster>-proxy` | per-Service proxy devices | `k8s-core:tailscaleProxyDefaultTags[1]` |
| `tag:k8s-<cluster>-operator` | the operator device | `k8s-essentials:tailscaleOperatorDefaultTags[0]` |
| `tag:k8s-<cluster>-argo` | the Argo CD UI proxy, only when `argoEnabled` | derived from the first proxy tag in `pulumi/k8s-essentials/argo/index.ts` |

Give each tag owners (the group that owns existing `tag:k8s*` entries) and the grants other clusters have: the API server proxy is reachable by anyone granted to the operator tag, and Kubernetes groups come from the same policy ([access groups](../spec/kubernetes/namespaces.md#access-groups)).
Merge and apply it, then confirm the tags appear in the policy file (<https://login.tailscale.com/admin/acls/file>) before continuing.
An exit node (`tailscaleExitNodeName`) is tagged `tag:server`, which the policy must also allow the operator to apply.

**[dev-OTS]** a merged policy change affects who can reach the cluster. An older cluster may use the unqualified `tag:k8s`, `tag:k8s-proxy` and `tag:k8s-operator`; do not follow that on a new cluster.

## 2. Federated identity for the operator

The operator authenticates with an OIDC token minted by the cluster's own issuer, so no client secret is stored.

1. Read the issuer URL (needs a `ReadAccess` profile for the account). **[diagnose]**

   ```
   aws-sso exec -p <profile> -- aws eks describe-cluster --name <cluster> --query 'cluster.identity.oidc.issuer' --output text
   ```

2. In the Tailscale admin console (<https://login.tailscale.com/admin/settings/oauth>), add an OIDC credential with a custom issuer. **[dev-OTS]**

   | field | value |
   |---|---|
   | issuer | the URL from step 1 |
   | subject | `system:serviceaccount:tailscale-system:operator` |
   | scopes | `devices:core:write`, `auth_keys:write`, `services:write`, and no others |
   | tags | `tag:k8s-<cluster>-operator` |

3. Record the client id and audience it shows. Both are non-secret. They go in the k8s-essentials config (`tailscaleClientId`, `tailscaleAudience`, [config reference](../reference/k8s-essentials-config.md)).

Creating a stored client secret is not part of this procedure and is not something to suggest: if a cluster seems to need one, escalate.

## Moving an older cluster off its stored client secret

Older clusters keep `tailscaleClientSecret` in config, and the code prefers it over the audience when both are set.
To move one: do steps 1 and 2 above for that cluster, set `tailscaleAudience` and the new client id, remove `tailscaleClientSecret`, apply `k8s-essentials`, confirm the operator device is still healthy, then delete the old OAuth client in the Tailscale admin console.
**[dev-OTS]**
