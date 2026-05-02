import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/coreRef.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../../common/k8s/affinities.ts';
import { namespace } from './namespace.ts';
import { provider } from '../kubeconfig.ts';
import { CERTMANAGER_VERSION } from '../versions.ts';

const externalDns = cfg.getBoolean('enableExternalDns') ?? true;

// Gateway API integration is for the Envoy Gateway TLS auto-issuance flow.
// cert-manager v1.20+ does a hard preflight check on startup: if the
// Gateway API CRDs aren't present, it exits and crash-loops. Envoy Gateway
// in k8s-essentials installs those CRDs, but only when its own
// envoyGatewayEnabled config is true — so cert-manager has to be gated to
// match. Default false; flip true on stacks where Envoy Gateway is also
// enabled.
const enableGatewayAPI = cfg.getBoolean('enableCertManagerGateway') ?? false;

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
      // See `enableGatewayAPI` const above. https://cert-manager.io/docs/usage/gateway/
      config: { enableGatewayAPI },
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
