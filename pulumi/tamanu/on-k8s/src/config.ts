import { Config, getStack, output, type Output } from '@pulumi/pulumi';
import * as semver from 'semver';
import { billingTags } from '../../../common/billing.ts';
import {
  backups,
  cfg,
  clusterFullName,
  externalDnsZoneDomains,
  tailscaleProxyDefaultTags,
} from '../../../common/k8s/coreRef.ts';
import type { Architecture } from '../../../common/k8s/affinities.ts';
import { truncateDomainIfNeeded } from '../../../common/dns.ts';
import { imageTag } from './image.ts';

export const normalizedStack = getStack()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63 - 'tamanu-'.length) // 63 is the max length of a k8s namespace, minus the prefix tamanu-
  .replace(/^-+|-+$/g, '');

const _configTemplateRaw = cfg.get('configTemplate');

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
const _domainStack =
  _isDemoCluster ? normalizedStack.replace(/-demo$/, '') : normalizedStack;
export const domainBase =
  cfg.get('domainBase') ??
  truncateDomainIfNeeded(_domainStack, _clusterBaseDomain);

export const dbStorage = cfg.get('dbStorage') ?? '5Gi';
// Puts the blob store on a shared volume rather than each pod's own disk.
// Needs the cluster's k8s-core to have the efs storage class, so it stays
// opt-in until every cluster hosting a deploy has it.
export const sharedBlobStorage = cfg.getBoolean('sharedBlobStorage') ?? false;
export const dbExpose = cfg.getBoolean('dbExpose') ?? true;
// Tags for the Tailscale proxy device fronting the central DB. The proxy tag is
// cluster-specific (each cluster's operator OAuth client only owns its own), so
// take it from k8s-core rather than hardcoding; append the server tags the ACLs
// grant DB access on.
export const dbExposeTags = [
  ...tailscaleProxyDefaultTags,
  'tag:server',
  'tag:server-tamanu',
  ...(_isDemoCluster ? ['tag:server-tamanu-demo'] : []),
].join(',');
// Pin each db cluster's instances to one AZ (cross-AZ replication is billed).
// This package currently deploys demo/branch environments, where losing an AZ
// is acceptable; set to false for any production-grade stack.
export const dbAzColocate = cfg.getBoolean('dbAzColocate') ?? true;
// CNPG's budget on the primary allows no evictions, which exempts every node
// holding one from consolidation. Demo and branch environments take a
// failover on drain instead; set to true for any production-grade stack.
export const dbDisruptionBudgets = cfg.getBoolean('dbDisruptionBudgets') ?? false;
// Demo databases hold little data and use ~200-450MiB; branch environments on
// the main cluster run closer to the default.
export const dbMemory = cfg.get('dbMemory') ?? (_isDemoCluster ? '512Mi' : '750Mi');
export const timezone = cfg.get('timezone') ?? 'Pacific/Auckland';
export const ipAllowList: undefined | string[] = cfg.getObject('ipAllowList') ?? undefined; // TODO

export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const nodeEnv = cfg.get('nodeEnv') ?? 'production';

export const DEFAULT_CONFIG_TEMPLATE = 'basic';
export const configTemplate = cfg.get('configTemplate') ?? DEFAULT_CONFIG_TEMPLATE;

export const serviceAccount: undefined | string = cfg.get('serviceAccount');

export interface ReplicaConfig {
  api: number;
  db: number;
  tasks: number;
  web: number;
}

const MIN_REPLICAS: ReplicaConfig = {
  api: 0,
  db: 2,
  tasks: 0,
  web: 0,
};
const MAX_REPLICAS: ReplicaConfig = {
  api: 5,
  db: 3,
  tasks: 1,
  web: 5,
};
const DEFAULT_REPLICAS: ReplicaConfig = {
  api: 2,
  db: 2,
  tasks: 1,
  web: 2,
};

function getReplicas(
  serverType: 'api' | 'db' | 'tasks' | 'web',
  server: 'central' | 'facility',
  defaultValue: null | number = null,
) {
  const specificName = `${server}${serverType[0].toUpperCase()}${serverType.slice(1)}Replicas`;
  const genericName = `${serverType}Replicas`;
  return Math.max(
    Math.min(
      MAX_REPLICAS[serverType],
      cfg.getNumber(specificName) ??
        cfg.getNumber(genericName) ??
        defaultValue ??
        DEFAULT_REPLICAS[serverType],
    ),
    MIN_REPLICAS[serverType],
  );
}

function getServerReplicas(server: 'central' | 'facility') {
  return {
    api: getReplicas('api', server),
    db: getReplicas('db', server),
    tasks: getReplicas('tasks', server),
    web: getReplicas('web', server),
  };
}

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

/** Facility ids alone, as the provisioning template expects them. */
export const facilityIds: string[] = facilityList.map(({ id }) => id);

export const replicas: { central: ReplicaConfig; facility: ReplicaConfig } = {
  central: getServerReplicas('central'),
  facility: getServerReplicas('facility'),
};

export const domains = {
  central: `central.${domainBase}`,
  ...Object.fromEntries(facilityList.map(({ host }) => [host, `${host}.${domainBase}`])),
  patientPortal: `portal.${domainBase}`,
};

/**
 * Hostnames this deployment serves only to redirect away from, mapping the
 * retired hostname to the URL that replaced it. Set when a rename moves a URL
 * and existing bookmarks need to keep working.
 */
export const redirects: Record<string, string> = cfg.getObject('redirects') ?? {};

export const patientPortalReplicas = cfg.getNumber('patientPortalReplicas') ?? 2;

export const syntheticTests = cfg.getBoolean('syntheticTests') ?? false;

const _backupsRaw = cfg.get('backupsEnabled');
export const backupsEnabled =
  _backupsRaw != null && _backupsRaw !== 'null' ? (cfg.getBoolean('backupsEnabled') ?? false) : false;
const _retentionRaw = cfg.get('backupRetentionDays');
export const backupRetentionDays =
  _retentionRaw != null && _retentionRaw !== 'null' ? (cfg.getNumber('backupRetentionDays') ?? 3) : 3;

// IAM role that CNPG pods assume (via IRSA) to write Barman backups to S3.
// Always set on the serviceAccountTemplate so the annotation is ready before
// backupsEnabled is flipped on.
// Defaults to undefined so postgres.ts falls back to backups.sa (the cluster's own
// IRSA role created by k8s-core/backups.ts). Override per-stack with
// tamanu-on-k8s:barmanRoleArn to point at a dedicated role in another account.
export const BARMAN_BACKUP_ROLE_ARN: string | undefined = cfg.get('barmanRoleArn') ?? undefined;

// S3 bucket for Barman WAL archiving and base backups.
// Defaults to the cluster's own bucket created by k8s-core/backups.ts.
// Override per-stack with tamanu-on-k8s:barmanBucket (e.g. to preserve an
// existing bucket when migrating an established deployment).
const _barmanBucketOverride = cfg.get('barmanBucket');
export const BARMAN_BACKUP_BUCKET: Output<string> = _barmanBucketOverride
  ? output(_barmanBucketOverride)
  : (backups.bucket as Output<string>);

const _seedSnapshotRaw = cfg.get('seedSnapshot');
export const seedSnapshot: boolean =
  _seedSnapshotRaw != null && _seedSnapshotRaw !== 'null'
    ? (cfg.getBoolean('seedSnapshot') ?? false)
    : false;
export const appVersion: string | undefined = cfg.get('appVersion') ?? undefined;

// The Tamanu version this stack is deploying, for gating on features a given release has.
// Auto-deploys always use `sha-<gitsha>` image tags but set appVersion from the branch's
// package.json, so prefer that; standing envs pin a `v<version>` tag with no appVersion, so
// fall back to the tag.
export const releaseVersion: string | null =
  semver.valid(appVersion ?? '') ?? semver.valid(imageTag);

// Release branches before 2.59 send neither appVersion nor a semver tag, so an unresolvable
// version reads as too old for the feature. Gating the other way puts a subcommand the image
// does not have into a Job, which then either never exits or exits 1, taking the deploy with it.
export function atLeastVersion(version: string): boolean {
  return releaseVersion != null && semver.gte(releaseVersion, version);
}

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
export const costLabels = billingTags({
  product: 'tamanu',
  stage,
  deployment,
});
