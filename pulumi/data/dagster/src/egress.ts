import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { tailnetHosts, tailnetTag } from './config.ts';

// spec: DAGS#tailnet-egress
for (const { name, fqdn } of tailnetHosts) {
  new k8s.core.v1.Service(
    `tailnet-${name}`,
    {
      // The name is what the code locations connect to.
      metadata: {
        name,
        namespace,
        annotations: {
          'tailscale.com/tailnet-fqdn': fqdn,
          'tailscale.com/tags': tailnetTag,
        },
      },
      // The operator replaces the external name with its own proxy's.
      spec: { type: 'ExternalName', externalName: 'placeholder' },
    },
    { ignoreChanges: ['spec.externalName'] },
  );
}
