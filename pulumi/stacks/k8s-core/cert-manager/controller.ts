import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/coreRef.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../../common/k8s/affinities.ts';
import { namespace } from './namespace.ts';
import { provider } from '../kubeconfig.ts';
import { CERTMANAGER_VERSION } from '../versions.ts';

const externalDns = cfg.getBoolean('enableExternalDns') ?? true;

export const certManager = new k8s.helm.v3.Release(
  'cert-manager',
  {
    chart: 'cert-manager',
    version: CERTMANAGER_VERSION,
    repositoryOpts: {
      repo: 'https://charts.jetstack.io',
    },
    namespace,
    values: {
      installCRDs: true,
      // Enable Gateway API integration so cert-manager watches Gateway resources
      // and auto-issues certificates for TLS listeners annotated with
      // cert-manager.io/cluster-issuer.  Required for the Envoy Gateway migration.
      // See: https://cert-manager.io/docs/usage/gateway/
      config: { enableGatewayAPI: true },
      replicaCount: 2,
      podDisruptionBudget: {
        enabled: true,
        minAvailable: 1,
      },
      serviceAccount: externalDns
        ? {
            create: false,
            name: (await import('./policy.ts')).sa.metadata.name,
          }
        : { create: false },
      tolerations: [CAN_RUN_ON_SPOT],
      affinity: {
        nodeAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 1,
              preference: RUN_ON_SPOT,
            },
          ],
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [purposeAffinity('ingress')],
              },
            ],
          },
        },
      },
      topologySpreadConstraints: [
        {
          maxSkew: 1,
          minDomains: 2,
          topologyKey: 'topology.kubernetes.io/zone',
          whenUnsatisfiable: 'DoNotSchedule',
          labelSelector: {
            matchExpressions: [
              { key: 'app.kubernetes.io/name', operator: 'In', values: ['cert-manager'] },
            ],
          },
        },
      ],
      strategy: {
        type: 'RollingUpdate',
        rollingUpdate: {
          maxUnavailable: 1,
          maxSurge: 1,
        },
      },
    },
  },
  { provider },
);
