import { getStack } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/k8s/coreRef.js';

const ns = new k8s.core.v1.Namespace(
  `tamanu-${getStack()}`,
  {
    metadata: {
      name: cfg.get('namespace'),
    },
  },
  { ignoreChanges: ['metadata.name'] },
);

export const namespace = ns.metadata.name;

new k8s.apiextensions.CustomResource(
  'parent-ns',
  {
    apiVersion: 'hnc.x-k8s.io/v1alpha2',
    kind: 'HierarchyConfiguration',
    metadata: {
      name: 'hierarchy',
      namespace,
    },
    spec: {
      parent: 'tamanu-super',
    },
  },
  { parent: ns },
);

// until images are public:
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sClient } from '../../common/k8s/client.js';
const k8sApi = k8sClient(CoreV1Api);
new k8s.core.v1.Secret('pullsecret-github', {
  metadata: { name: 'pullsecret-github', namespace },
  type: 'kubernetes.io/dockerconfigjson',
  data: await k8sApi.readNamespacedSecret('pullsecret-github', 'tamanu-system').then(resp => resp.body.data),
});
