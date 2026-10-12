import { type Output, getStack, jsonStringify } from '@pulumi/pulumi';
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

// The input contract with tamanu-render (its params.rs). Stack config keeps the
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

function stackConfig() {
  return {
    namespace: str('namespace'),
    domainBase: str('domainBase'),
    configTemplate: str('configTemplate'),
    nodeEnv: str('nodeEnv'),
    architecture: str('architecture'),
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
  };
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
