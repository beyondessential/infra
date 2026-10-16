import * as k8s from '@pulumi/kubernetes';
import { region } from '../../common/awsAccount.ts';
import { provider } from '../kubeconfig.ts';
import { certManager } from './controller.ts';

new k8s.apiextensions.CustomResource('letsencrypt', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'ClusterIssuer',
  // no namespace: ClusterIssuer is cluster-scoped
  metadata: {
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
