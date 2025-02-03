import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../common/k8s/coreRef.js';
await failIfIncorrectCluster();

const ns = new k8s.core.v1.Namespace('bestool-proxy', {
  metadata: {
    name: 'bestool-proxy',
  },
});
const namespace = ns.metadata.name;

for (const [name, endpoint] of Object.entries({
  tools: 'tools.ops.tamanu.io',
  servers: 'servers.ops.tamanu.io',
})) {
  new k8s.core.v1.Service(`bestool-proxy-${name}`, {
    metadata: {
      name,
      namespace,
      annotations: {
        'tailscale.com/expose': 'true',
        'tailscale.com/tags': 'tag:k8s,tag:tools,tag:tools-proxy',
      },
    },
    spec: {
      type: 'ExternalName',
      externalName: endpoint,
    },
  });
}
