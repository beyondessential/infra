import { type Output, getStack, jsonStringify, runtime } from '@pulumi/pulumi';
import { cfg } from '../../../../common/cfg.ts';
import {
  $network,
  backups,
  clusterFullName,
  externalDnsZoneDomains,
  tailscaleProxyDefaultTags,
} from '../../../../common/k8s/coreRef.ts';
import { deployment, stage } from '../config.ts';
import { imageTag } from '../image.ts';

// The input contract with infra-argo-tamanu-renderer (its params.rs). Stack config keeps the
// names it has here and is passed as typed JSON; the renderer owns the
// defaults. Keys it does not know are rejected there, so a key is added in both
// places or not at all.

// CD writes an unset option as the string "null".
function raw(key: string): string | undefined {
  const value = cfg.get(key);
  return value == null || value === 'null' ? undefined : value;
}

const str = raw;
const num = (key: string) => {
  const value = raw(key);
  return value === undefined ? undefined : Number(value);
};
const bool = (key: string) => {
  const value = raw(key);
  return value === undefined ? undefined : value === 'true';
};
const obj = <T>(key: string): T | undefined => {
  const value = raw(key);
  return value === undefined ? undefined : (JSON.parse(value) as T);
};

// Keys the program reads that the renderer does not take: the stub uses them
// itself, they only matter to the legacy path, or they are not rendered.
const HANDLED_ELSEWHERE = new Set([
  'imageTag',
  'appVersion',
  'k8s-core',
  'externalNamespace',
  'ttlHours',
  'deployer',
  'deployment',
  'ipAllowList',
  'seedSnapshot',
  'argoNamespace',
  'argoProject',
  'argoWaitMinutes',
  'rendererRepo',
  'rendererRef',
  'rendererPath',
]);

// A stack key that is neither passed on nor handled elsewhere would be silently
// dropped, and the deployment would render differently from what the legacy
// program does with it. Fail instead.
function rejectUnforwardedKeys(forwarded: string[]): void {
  const known = new Set([...forwarded, ...HANDLED_ELSEWHERE]);
  const project = `${cfg.name}:`;
  const unknown = Object.keys(runtime.allConfig())
    .filter((key) => key.startsWith(project))
    .map((key) => key.slice(project.length))
    .filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Stack config not passed to infra-argo-tamanu-renderer: ${unknown.join(', ')}. ` +
        "Add each to params.ts and to the renderer's params.rs, or list it in HANDLED_ELSEWHERE.",
    );
  }
}

function stackConfig() {
  const config = {
    namespace: str('namespace'),
    domainBase: str('domainBase'),
    configTemplate: str('configTemplate'),
    nodeEnv: str('nodeEnv'),
    architecture: str('architecture'),
    capacity: str('capacity'),
    timezone: str('timezone'),
    facilities: num('facilities'),
    facilityNames: obj<unknown[]>('facilityNames'),
    redirects: obj<Record<string, string>>('redirects'),

    apiReplicas: num('apiReplicas'),
    dbReplicas: num('dbReplicas'),
    tasksReplicas: num('tasksReplicas'),
    webReplicas: num('webReplicas'),
    centralApiReplicas: num('centralApiReplicas'),
    centralDbReplicas: num('centralDbReplicas'),
    centralTasksReplicas: num('centralTasksReplicas'),
    centralWebReplicas: num('centralWebReplicas'),
    facilityApiReplicas: num('facilityApiReplicas'),
    facilityDbReplicas: num('facilityDbReplicas'),
    facilityTasksReplicas: num('facilityTasksReplicas'),
    facilityWebReplicas: num('facilityWebReplicas'),
    patientPortalReplicas: num('patientPortalReplicas'),

    serviceAccount: str('serviceAccount'),
    dbStorage: str('dbStorage'),
    dbMemory: str('dbMemory'),
    dbExpose: bool('dbExpose'),
    dbAzColocate: bool('dbAzColocate'),
    dbDisruptionBudgets: bool('dbDisruptionBudgets'),
    sharedBlobStorage: bool('sharedBlobStorage'),
    backupsEnabled: bool('backupsEnabled'),
    backupRetentionDays: num('backupRetentionDays'),
    barmanRoleArn: str('barmanRoleArn'),
    barmanBucket: str('barmanBucket'),
    syntheticTests: bool('syntheticTests'),
  };
  rejectUnforwardedKeys(Object.keys(config));
  return config;
}

/** The renderer's parameter document, as the JSON an Argo plugin receives. */
export function renderParams(): Output<string> {
  return jsonStringify({
    stack: getStack(),
    imageTag,
    appVersion: str('appVersion'),
    config: stackConfig(),
    cluster: {
      fullName: clusterFullName,
      dnsZoneDomains: externalDnsZoneDomains,
      tailscaleProxyDefaultTags,
      networkV4Cidr: $network.apply((n) => n.v4Cidr),
      networkV6Cidr: $network.apply((n) => n.v6Cidr),
      backupsBucket: backups.bucket,
      backupsServiceAccountArn: backups.sa,
    },
    billing: { stage, deployment },
  });
}
