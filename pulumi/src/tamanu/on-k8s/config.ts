import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/k8s/coreRef.js';
import { Architecture } from '../../common/k8s/affinities.js';

export const domainBase = cfg.get('domainBase') ?? `${getStack()}.internal.tamanu.io`; // TODO: use k8score's/k8s-infra's base?
export const dbStorage = cfg.get('dbStorage') ?? '5Gi';
export const facilities = cfg.getNumber('facilities') ?? 2;
export const timezone = cfg.get('timezone') ?? 'Pacific/Auckland';
export const ipAllowList: undefined | string[] = cfg.getObject('ipAllowList') ?? undefined; // TODO

export const architecture: Architecture = cfg.get('architecture') ?? 'amd64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const DEFAULT_CONFIG_TEMPLATE = 'basic';
export const configTemplate = cfg.get('configTemplate') ?? DEFAULT_CONFIG_TEMPLATE;

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

function getReplicas(serverType: 'api' | 'db' | 'tasks' | 'web', server: 'central' | 'facility', defaultValue: number = null) {
  const specificName = `${server}${serverType[0].toUpperCase()}${serverType.slice(1)}Replicas`;
  const genericName = `${serverType}Replicas`;
  return Math.max(
    Math.min(
      MAX_REPLICAS[serverType],
      cfg.getNumber(specificName) ?? cfg.getNumber(genericName) ?? defaultValue ?? DEFAULT_REPLICAS[serverType],
    ),
    MIN_REPLICAS[serverType],
  );
}

export const replicas: { central: ReplicaConfig; facility: ReplicaConfig } = {
  central: {
    api: getReplicas('api', 'central'),
    db: getReplicas('db', 'central'),
    tasks: getReplicas('tasks', 'central'),
    web: getReplicas('web', 'central'),
  },
  facility: {
    api: getReplicas('api', 'facility', 1),
    db: getReplicas('db', 'facility'),
    tasks: getReplicas('tasks', 'facility', 0),
    web: getReplicas('web', 'facility'),
  },
};

export const domains = {
  central: `central.${domainBase}`,
  ...Object.fromEntries(
    Array.from({ length: facilities }, (_, i) => [
      `facility${i + 1}`,
      `facility-${i + 1}.${domainBase}`,
    ]),
  ),
};
