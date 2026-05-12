import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import { endpointHost, endpointPort, hostname, tags } from './config.ts';
import { namespace } from './namespace.ts';

new k8s.core.v1.Service(hostname, {
  metadata: {
    namespace,
    annotations: {
      'tailscale.com/expose': 'true',
      'tailscale.com/hostname': hostname,
      'tailscale.com/tags': tags.join(','),
    },
  },
  spec: {
    type: 'ExternalName',
    externalName: endpointHost,
    ports: [{ port: endpointPort, protocol: 'TCP' }],
  },
});
