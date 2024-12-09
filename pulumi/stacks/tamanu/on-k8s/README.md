## Domains

By default, the stack name will be normalised (lowercase with hyphens) and truncated, then prepended to `.internal.tamanu.io`.
That forms the "domain base", then facility, central, etc names are prepended as subdomains.

## Config required

- `imageTag` - Specify what version is deployed, see <https://github.com/beyondessential/tamanu/releases> or <https://github.com/beyondessential/tamanu/pkgs/container/tamanu-central>.
- `k8s-core` - Which Kubernetes cluster to deploy to, use `bes/k8s-core/tamanu-internal-main`.

You also need a Kubernetes/kubectl connection config to the cluster (see below).

## Config optionals

- `domainBase` - The "domain base" can be overridden entirely with this config.
- `dbStorage` - How much storage to give Postgres. Must be `<number>Gi`, defaults to `5Gi`.
- `dbBackups` - Experimental, do not use.
- `facilities` - Number of facilities to deploy, defaults to 2.
- `facilityNames` - Array of subdomain names of facilities. If there are less than the count `facilities`, then the unnamed ones are filled as `facility-N`.
- `timezone` - Timezone, defaults to `Pacific/Auckland`.
- `ipAllowList` - Experimental, do not use.
- `architecture` - Defaults to `amd64`, use `arm64`.
- `configTemplate` - Advanced usage, defaults to `basic`.

```
export const domainBase =
  cfg.get('domainBase') ?? truncateDomainIfNeeded(normalizedStack, 'internal.tamanu.io');

export const dbStorage = cfg.get('dbStorage') ?? '5Gi';
export const dbBackups: string | boolean = cfg.getObject('dbBackups') ?? false;
export const facilities = cfg.getNumber('facilities') ?? 2;
export const timezone = cfg.get('timezone') ?? 'Pacific/Auckland';
export const ipAllowList: undefined | string[] = cfg.getObject('ipAllowList') ?? undefined; // TODO

export const architecture: Architecture = cfg.get('architecture') ?? 'amd64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const configTemplate = cfg.get('configTemplate') ?? DEFAULT_CONFIG_TEMPLATE;
```

## Connect to Kubernetes via Tailscale

Install Kubectl: https://kubernetes.io/docs/tasks/tools/install-kubectl-linux

Create the folder: `mkdir -p ~/.kube`

Paste the kubectl config in the `~/.kube/config` file:

```
kind: Config
apiVersion: v1
clusters:
- cluster:
    server: https://k8s-operator-tamanu-internal-main.tail53aef.ts.net
  name: k8s-operator-tamanu-internal-main.tail53aef.ts.net
contexts:
- context:
    cluster: k8s-operator-tamanu-internal-main.tail53aef.ts.net
    user: tailscale-auth
  name: k8s-operator-tamanu-internal-main.tail53aef.ts.net
current-context: k8s-operator-tamanu-internal-main.tail53aef.ts.net
preferences: {}
users:
- name: tailscale-auth
  user:
    token: unused
```

(for example `nano ~/.kube/config`, then paste in, then save with Ctrl-O, then Ctrl-X to exit)

Then verify it works with `kubectl cluster-info`. You should see something like:

```
Kubernetes control plane is running at https://k8s-operator-tamanu-internal-main.tail53aef.ts.net
```
