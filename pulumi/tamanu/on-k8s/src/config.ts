import { Config, getStack } from '@pulumi/pulumi';
import { cfg, clusterFullName, externalDnsZoneDomains } from '../../../common/k8s/coreRef.ts';
import { truncateDomainIfNeeded } from '../../../common/dns.ts';

export const normalizedStack = getStack()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63 - 'tamanu-'.length) // 63 is the max length of a k8s namespace, minus the prefix tamanu-
  .replace(/^-+|-+$/g, '');

// Use the cluster's own DNS zones to pick the ingress base domain rather than
// relying on configTemplate. The demo cluster owns 'demos.tamanu.app'; the main
// cluster uses 'cd.tamanu.app' (a sub-zone of 'tamanu.app' it manages).
// Fall back to clusterFullName until k8s-core publishes externalDnsZoneDomains.
const _isDemoCluster =
  externalDnsZoneDomains.includes('demos.tamanu.app') || clusterFullName.includes('demo');
const _clusterBaseDomain = _isDemoCluster ? 'demos.tamanu.app' : 'cd.tamanu.app';

// For demo stacks, strip the trailing "-demo" suffix from the domain segment so
// URLs read "central.fsm.demos.tamanu.app" rather than the redundant
// "central.fsm-demo.demos.tamanu.app". Tailscale and k8s resource names still
// use normalizedStack (with the suffix) so demos remain identifiable on the mesh.
const _domainStack = _isDemoCluster ? normalizedStack.replace(/-demo$/, '') : normalizedStack;
export const domainBase =
  cfg.get('domainBase') ?? truncateDomainIfNeeded(_domainStack, _clusterBaseDomain);

export const facilities = cfg.getNumber('facilities') ?? 2;

/**
 * A facility's Tamanu identity and where it is served.
 *
 * `id` is the facility id in the central database, and doubles as the facility
 * server's device id. `host` is the subdomain label it answers on. They are
 * usually the same, but keeping them separate lets a facility be renamed in the
 * database without moving its URL, or moved without being renamed.
 */
export interface Facility {
  id: string;
  host: string;
}

/** A `facilityNames` entry: a bare name, or an id with an explicit host label. */
type FacilityEntry = string | { id: string; host?: string };

const facilityEntries: FacilityEntry[] = cfg.getObject('facilityNames') ?? [];
if (facilityEntries.length > facilities) {
  throw new Error('Cannot have more facilityNames than facilities');
}

export const facilityList: Facility[] = [
  ...facilityEntries,
  ...Array.from(
    { length: facilities - facilityEntries.length },
    (_, i) => `facility-${facilityEntries.length + i + 1}`,
  ),
].map((entry) => {
  // A bare name is lowercased for both: deployments predating the split have
  // lowercase facility ids in their databases, and lowercasing is what put them
  // there.
  if (typeof entry === 'string') {
    return { id: entry.toLowerCase(), host: entry.toLowerCase() };
  }

  if (!entry.id) {
    throw new Error('Facility entries must have an id');
  }

  // Case survives in the id — facility ids are arbitrary strings and some
  // deployments capitalise them — but a hostname label cannot carry it.
  return { id: entry.id, host: (entry.host ?? entry.id).toLowerCase() };
});

for (const key of ['id', 'host'] as const) {
  const values = facilityList.map((facility) => facility[key]);
  if (values.length !== new Set(values).size) {
    throw new Error(`Facility ${key}s must be unique`);
  }
}

export const domains = {
  central: `central.${domainBase}`,
  ...Object.fromEntries(facilityList.map(({ host }) => [host, `${host}.${domainBase}`])),
  patientPortal: `portal.${domainBase}`,
};

const _seedSnapshotRaw = cfg.get('seedSnapshot');
export const seedSnapshot: boolean =
  _seedSnapshotRaw != null && _seedSnapshotRaw !== 'null'
    ? (cfg.getBoolean('seedSnapshot') ?? false)
    : false;

export const configTemplate = cfg.get('configTemplate') ?? 'basic';

// Release-branch deploys get configTemplate 'rc' (see parseDeployConfig in tamanu's
// ghaCdHelpers). Those exist to rehearse the release, so they seed from the previous
// minor's snapshot and migrate forward, rather than from their own version's snapshot,
// which already has the release's migrations applied.
export const seedFromPreviousMinor: boolean = configTemplate === 'rc';

// 0 (default) means no TTL — deployment stays up forever. Any positive value
// sets a per-deploy lifetime in hours, re-anchored to the moment of every
// `pulumi up`. After the TTL elapses without a fresh `pulumi up`, the
// namespace is suspended (kube-downscaler scales workloads to zero) and the
// CNPG databases are hibernated. Pushing to the branch — or otherwise
// re-running pulumi up — restores the deployment.
export const ttlHours = cfg.getNumber('ttlHours') ?? 0;
if (!Number.isInteger(ttlHours) || ttlHours < 0) {
  throw new Error(`ttlHours must be a non-negative integer, got: ${ttlHours}`);
}

export const deployment = cfg.get('deployment') ?? 'engineering';
export const stage = new Config('billing').get('stage') ?? 'test';
