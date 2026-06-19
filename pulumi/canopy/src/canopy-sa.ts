import * as k8s from '@pulumi/kubernetes';
import type { Output } from '@pulumi/pulumi';

import { cfg } from '../../common/k8s/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';
import { CANOPY_SA_ISSUER, CANOPY_SA_JOBS, CANOPY_SA_PRIVATE } from '../../constants/canopy.ts';
import { namespace } from './namespace.ts';

// Gated on the canopy-infra stack ref: when absent (e.g. dev), no ServiceAccounts
// are created and the Deployments stay on the namespace default SA, exactly as
// before. The exported SA names are undefined in that case so callers skip
// `serviceAccountName`.
const infraRef = cfg.get('canopy-infra');

function serviceAccount(name: string, roleArn: Output<string>, secretVerbs: string[]): void {
  new k8s.core.v1.ServiceAccount(name, {
    metadata: {
      name,
      namespace,
      annotations: { 'eks.amazonaws.com/role-arn': roleArn },
    },
  });

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

if (infraRef) {
  const infra = new CrossStack(infraRef);
  serviceAccount(CANOPY_SA_ISSUER, infra.get<string>('canopyIssuerRoleArn'), ['get']);
  serviceAccount(CANOPY_SA_JOBS, infra.get<string>('canopyJobsRoleArn'), ['get']);
  // The setup wizard creates the passphrase Secret, so private-server also gets create.
  serviceAccount(CANOPY_SA_PRIVATE, infra.get<string>('canopyPrivateRoleArn'), ['get', 'create']);
}

export const canopyIssuerSa = infraRef ? CANOPY_SA_ISSUER : undefined;
export const canopyJobsSa = infraRef ? CANOPY_SA_JOBS : undefined;
export const canopyPrivateSa = infraRef ? CANOPY_SA_PRIVATE : undefined;
