# SOP: Connect to a cluster with kubectl

Two ways in: over the tailnet (normal), or directly to the EKS endpoint with an AWS identity (bootstrap and recovery).
Placeholders are defined in [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).
Requirements: [cluster endpoint access](../spec/kubernetes/namespaces.md#cluster-endpoint-access) and [direct access](../spec/kubernetes/namespaces.md#direct-access).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Editing `~/.kube/config` changes nothing on a cluster.

## Over the tailnet

You need to be on the tailnet and in an [access group](../spec/kubernetes/namespaces.md#access-groups).
Your permissions are whatever the groups bind; there is no Kubernetes credential to hold.

1. Add the tailnet cluster to `~/.kube/config`, with the host `k8s-operator-<stack>.<tailnet-domain>` (`TAILNET_DOMAIN` in `pulumi/constants/internal.ts`). **[diagnose]**

   ```yaml
   clusters:
   - cluster:
       server: https://k8s-operator-<stack>.<tailnet-domain>
     name: k8s-operator-<stack>.<tailnet-domain>
   contexts:
   - context:
       cluster: k8s-operator-<stack>.<tailnet-domain>
       user: tailscale-auth
     name: k8s-operator-<stack>.<tailnet-domain>
   current-context: k8s-operator-<stack>.<tailnet-domain>
   users:
   - name: tailscale-auth
     user:
       token: unused
   ```

2. Check it. **[diagnose]**

   ```
   kubectl cluster-info
   ```

   Expect the control plane URL to be the tailnet host.

If it hangs, errors with 401 or 403, or the device is missing, see [cluster-api-unreachable](../runbooks/cluster-api-unreachable.md).

## Directly, with aws-sso

Use this only while the Tailscale operator is not up, or when it is the thing that is broken.
The AWS identity needs an EKS access entry; the repo does not declare which principals hold one, so ask who does if yours is refused.

1. Write the kubeconfig entry. **[diagnose]**

   ```
   aws-sso exec -p <profile> -- aws eks update-kubeconfig --name <cluster> --alias <context>
   ```

   `--alias` makes the context name match `kubernetes:context` in the stack config.

2. Wrap the token command, because there are no AWS credentials outside an aws-sso session. In `~/.kube/config`, find the user named `arn:aws:eks:...:cluster/<cluster>` and change `command: aws` to `command: aws-sso`, with these arguments placed before the existing ones. **[diagnose]**

   ```yaml
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
     # ...the rest unchanged
   ```

3. Check it. **[diagnose]**

   ```
   kubectl --context=<context> cluster-info
   ```

   Expect the EKS endpoint URL and CoreDNS. A hang or a 401 means the wrapping is wrong or the SSO session has expired; ask a human to run `aws-sso login`.

An agent uses only a `ReadAccess` profile for this.
A stack that needs AdminAccess is run by a human, and an agent never initiates it.

## Pulumi and the kubeconfig

In-cluster stacks (`k8s-essentials`, `tamanu/k8s-infra`, `canopy`) read the current kubeconfig cluster and refuse to run unless it is this cluster's tailnet host or its direct EKS endpoint (`failIfIncorrectCluster()` in `pulumi/common/k8s/coreRef.ts`).
They need the tailnet or the direct endpoint to be reachable when you run them, and no AWS credentials once the tailnet path is up.
`kubectl config view --raw` prints credentials: **[sensitive-data]**.
