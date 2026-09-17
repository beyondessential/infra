import * as k8s from '@pulumi/kubernetes';
import type { Output } from '@pulumi/pulumi';

import {
  CANOPY_SA_DOMAINS,
  CANOPY_SA_ISSUER,
  CANOPY_SA_JOBS,
  CANOPY_SA_PRIVATE,
} from '../../constants/canopy.ts';
import { canopyInfra } from './canopy-infra.ts';
import { namespace } from './namespace.ts';

// Gated on the canopy-infra stack ref: when absent (e.g. dev), no ServiceAccounts
// are created and the Deployments stay on the namespace default SA, exactly as
// before. The exported SA names are undefined in that case so callers skip
// `serviceAccountName`.

// `secretVerbs` empty means the identity is for AWS alone and gets no Role at
// all, rather than a Role granting nothing.
function serviceAccount(name: string, roleArn: Output<string>, secretVerbs: string[]): void {
  new k8s.core.v1.ServiceAccount(name, {
    metadata: {
      name,
      namespace,
      annotations: { 'eks.amazonaws.com/role-arn': roleArn },
    },
  });

  if (secretVerbs.length === 0) {
    return;
  }

  // Read (and, for the wizard, create) server-group repo-password Secrets.
  const role = new k8s.rbac.v1.Role(name, {
    metadata: { namespace },
    rules: [{ apiGroups: [''], resources: ['secrets'], verbs: secretVerbs }],
  });

  new k8s.rbac.v1.RoleBinding(name, {
    metadata: { namespace },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: role.metadata.name },
    subjects: [{ kind: 'ServiceAccount', name, namespace }],
  });
}

if (canopyInfra) {
  serviceAccount(CANOPY_SA_ISSUER, canopyInfra.get<string>('canopyIssuerRoleArn'), ['get']);
  // backups writes the rotated passphrase back, so canopy-jobs needs secret write.
  serviceAccount(CANOPY_SA_JOBS, canopyInfra.get<string>('canopyJobsRoleArn'), [
    'get',
    'create',
    'update',
    'patch',
  ]);
  // private-server creates the wizard's passphrase Secret, deletes it when a backup
  // config is decommissioned, and patches inventory-variable Secrets key by key.
  serviceAccount(CANOPY_SA_PRIVATE, canopyInfra.get<string>('canopyPrivateRoleArn'), [
    'get',
    'create',
    'patch',
    'delete',
  ]);
  // domains reaches Route 53 and nothing in the cluster.
  serviceAccount(CANOPY_SA_DOMAINS, canopyInfra.get<string>('canopyDomainsRoleArn'), []);
}

export const canopyIssuerSa = canopyInfra ? CANOPY_SA_ISSUER : undefined;
export const canopyJobsSa = canopyInfra ? CANOPY_SA_JOBS : undefined;
export const canopyPrivateSa = canopyInfra ? CANOPY_SA_PRIVATE : undefined;
export const canopyDomainsSa = canopyInfra ? CANOPY_SA_DOMAINS : undefined;
