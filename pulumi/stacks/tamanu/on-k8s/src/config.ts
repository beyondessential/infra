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
