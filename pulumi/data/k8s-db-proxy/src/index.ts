import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import { endpointHost, endpointPort, hostname, tags } from './config.ts';
import { namespace } from './namespace.ts';

// The cluster is IPv6-only, so the Tailscale operator's proxy node only gets
// an IPv6 tailnet address. RDS endpoints resolve dual-stack inside the VPC,
// which trips the operator's ingress rule installer (it bails when a backend
// has v4 addresses but the proxy lacks v4). We sidestep that by putting a
// v6-only ClusterIP backend in front: a tiny socat forwarder that proxies
// TCP to the RDS DNS name.

const selector = { 'k8s-db-proxy/target': hostname };

new k8s.apps.v1.Deployment(hostname, {
  metadata: { namespace },
  spec: {
    replicas: 1,
    selector: { matchLabels: selector },
    template: {
      metadata: { labels: selector },
      spec: {
        containers: [
          {
            name: 'socat',
            image: 'alpine/socat:1.8.0.3',
            args: [
              '-d',
              `TCP6-LISTEN:${endpointPort},fork,reuseaddr`,
              `TCP6:${endpointHost}:${endpointPort}`,
            ],
            ports: [{ containerPort: endpointPort, protocol: 'TCP' }],
            resources: {
              requests: { cpu: '10m', memory: '32Mi' },
            },
          },
        ],
      },
    },
  },
});

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
    type: 'ClusterIP',
    selector,
    ports: [{ port: endpointPort, targetPort: endpointPort, protocol: 'TCP' }],
  },
});
