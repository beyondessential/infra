## Domains

By default, the stack name will be normalised (lowercase with hyphens) and truncated, then prepended to `.internal.tamanu.io`.
That forms the "domain base", then facility, central, etc names are prepended as subdomains.

## Config required

- `imageTag` - Specify what version is deployed, see <https://github.com/beyondessential/tamanu/releases> or <https://github.com/beyondessential/tamanu/pkgs/container/tamanu-central>.
- `k8s-core` - Which Kubernetes cluster to deploy to, use `bes/k8s-core/tamanu-internal-main`.

## Config optionals

- `domainBase` - The "domain base" can be overridden entirely with this config.
- `dbStorage` - How much storage to give Postgres. Must be `<number>Gi`, defaults to `5Gi`.
- `dbBackups` - Experimental, do not use.
- `facilities` - Number of facilities to deploy, defaults to 2.
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
