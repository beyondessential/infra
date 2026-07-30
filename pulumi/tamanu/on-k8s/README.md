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
- `backupsEnabled` - Whether to back the databases up to S3 with Barman, defaults to false.
- `backupRetentionDays` - How long those backups are kept, defaults to 3.
- `facilities` - Number of facilities to deploy, defaults to 2.
- `facilityNames` - Array of facilities. Each entry is either a name, used as both the Tamanu facility id and its subdomain, or an object `{id, host}` to give a facility an id that differs from the subdomain it is served on. If there are fewer entries than the count `facilities`, the rest are filled as `facility-N`.
- `redirects` - Map of hostname to URL, for hostnames this deployment should serve only to redirect away from. Used when a rename moves a URL and existing links need to keep working.
- `timezone` - Timezone, defaults to `Pacific/Auckland`.
- `ipAllowList` - Experimental, do not use.
- `architecture` - Defaults to `arm64`.
- `configTemplate` - Advanced usage, defaults to `basic`.
- `schedule` - When the deployment should be running. One of:
  - `business-hours` (default) — Mon-Fri 08:30-18:45 in **either** Pacific/Auckland
    or Australia/Sydney (union, so it covers both regions including DST). Scaled
    down nights and weekends.
  - `weekdays` — running 24h Mon-Fri NZT, scaled down on weekends.
  - `always-on` — never scaled down.

  Storage (PVCs) is preserved regardless. Workload pods are scaled by the
  cluster's [py-kube-downscaler] via annotations on the namespace; CNPG
  databases are hibernated by per-namespace CronJobs that bracket the workload
  window with margin (DB up before any user logs in, down after the latest
  user logs off). See `docs/tamanu-on-k8s.md` §2.10 for details.

[py-kube-downscaler]: https://github.com/caas-team/py-kube-downscaler

`src/config.ts` is where these are read, and is the authority on defaults.

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
