import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.js';
import { region } from '../../common/awsAccount.js';
import { provider } from '../kubeconfig.js';
import { certManager } from './controller.js';

new k8s.apiextensions.CustomResource('letsencrypt', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'ClusterIssuer',
  metadata: {
    namespace,
    name: 'letsencrypt',
  },
  spec: {
    acme: {
      server: 'https://acme-v02.api.letsencrypt.org/directory',
      email: 'tls-renewal@bes.au',
      privateKeySecretRef: {
        name: 'letsecrypt',
      },
      solvers: [
        {
          selector: {},
          dns01: {
            route53: {
              region,
            }
          },
        },
      ],
    },
  },
}, { provider, dependsOn: [certManager] });
