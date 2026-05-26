import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../../common/k8s/coreRef.ts';
import type { Architecture } from '../../../common/k8s/affinities.ts';
import { truncateDomainIfNeeded } from '../../../common/dns.ts';

export const normalizedStack = getStack()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63 - 'tamanu-'.length) // 63 is the max length of a k8s namespace, minus the prefix tamanu-
  .replace(/^-+|-+$/g, '');

// TODO: use k8score's/k8s-infra's base?
export const domainBase =
  cfg.get('domainBase') ?? truncateDomainIfNeeded(normalizedStack, 'cd.tamanu.app');

export const dbStorage = cfg.get('dbStorage') ?? '5Gi';
export const dbExpose = cfg.getBoolean('dbExpose') ?? true;
export const dbBackups: string | boolean = cfg.getObject('dbBackups') ?? false;
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
let facilityNames: string[] = cfg.getObject('facilityNames') ?? [];
const named = facilityNames.length;
if (named > facilities) {
  throw new Error('Cannot have more facilityNames than facilities');
} else if (named < facilities) {
  facilityNames = facilityNames.concat(
    Array.from({ length: facilities - named }, (_, i) => `facility-${named + i + 1}`),
  );
}
facilityNames = facilityNames.map((name) => name.toLowerCase());
if (facilityNames.length != new Set(facilityNames).size) {
  throw new Error('Facility names must be unique');
}
export { facilityNames };

export const replicas: { central: ReplicaConfig; facility: ReplicaConfig } = {
  central: getServerReplicas('central'),
  facility: getServerReplicas('facility'),
};

export const domains = {
  central: `central.${domainBase}`,
  ...Object.fromEntries(facilityNames.map((name) => [name, `${name}.${domainBase}`])),
  patientPortal: `portal.${domainBase}`,
};

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
export const BARMAN_BACKUP_ROLE_ARN = 'arn:aws:iam::143295493206:role/tamanu-db-backups-staging';
export const BARMAN_BACKUP_BUCKET = 'tamanu-db-backups-staging';

const _seedSnapshotRaw = cfg.get('seedSnapshot');
export const seedSnapshot: boolean =
  _seedSnapshotRaw != null && _seedSnapshotRaw !== 'null'
    ? (cfg.getBoolean('seedSnapshot') ?? false)
    : false;
export const appVersion: string | undefined = cfg.get('appVersion') ?? undefined;

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
