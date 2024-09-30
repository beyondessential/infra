import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sClient } from '../../common/k8s/client.js';
import { namespace } from './namespace.js';

const k8sApi = k8sClient(CoreV1Api);

for (const secret of (await k8sApi.listNamespacedSecret('tamanu-system')).body.items) {
  const name = secret?.metadata?.name;
  if (!name) continue;

  new k8s.core.v1.Secret(name, {
    metadata: {
      name,
      namespace,
      labels: secret.metadata?.labels,
      annotations: secret.metadata?.annotations,
    },
    type: secret.type,
    immutable: secret.immutable,
    data: secret.data,
  });
}
