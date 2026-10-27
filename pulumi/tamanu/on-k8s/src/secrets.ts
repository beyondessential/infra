import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { cfg } from '../../../common/k8s/coreRef.ts';
import { k8sClient } from '../../../common/k8s/client.ts';
import { namespace } from './namespace.ts';

const k8sApi = k8sClient(CoreV1Api);

// Secrets of tamanu-system this deployment holds its own copy of, edited by hand in its
// namespace. They are left alone rather than copied over.
const localSecrets = new Set(cfg.getObject<string[]>('localSecrets') ?? []);

for (const secret of (await k8sApi.listNamespacedSecret({ namespace: 'tamanu-system' })).items) {
  const name = secret?.metadata?.name;
  if (!name || localSecrets.has(name)) continue;

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
