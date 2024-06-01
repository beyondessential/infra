import { randomBytes } from 'node:crypto';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.js';

const adminSecret = new k8s.core.v1.Secret(
  'grafana-admin',
  {
    metadata: {
      name: 'grafana-admin',
      namespace,
    },
    type: 'Opaque',
    stringData: {
      username: 'admin',
      password: randomBytes(20)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, ''),
    },
  },
  { ignoreChanges: ['data'] },
);

new k8s.helm.v3.Release('grafana', {
  chart: 'grafana',
  version: '7.3.7',
  repositoryOpts: {
    repo: 'https://grafana.github.io/helm-charts',
  },
  namespace,
  values: {
    autoscaling: {
      enabled: true,
    },
    persistence: {
      enabled: true,
    },
    admin: {
      existingSecret: adminSecret.metadata.name,
      userKey: 'username',
      passwordKey: 'password',
    },
    env: {
      GF_DATE_FORMATS_INTERVAL_HOUR: 'DD/MM HH:mm',
      GF_DATE_FORMATS_INTERVAL_DAY: 'DD/MM',
    },
    affinity: {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [{ key: 'bes.node.purpose', operator: 'In', values: ['system'] }],
            },
          ],
        },
      },
    },
    ingress: {
      enabled: true,
      ingressClassName: 'tailscale',
      hosts: ['grafana', 'grafana.tail53aef.ts.net'],
      tls: [
        { hosts: ['grafana'] },
      ],
      annotations: {
        'tailscale.com/tags': 'tag:tools',
      },
    },
  },
});
