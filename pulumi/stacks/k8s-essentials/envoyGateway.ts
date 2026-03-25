import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../common/k8s/affinities.ts';
import { clusterName } from '../common/k8s/coreRef.ts';
import { ENVOY_GATEWAY_VERSION } from './versions.ts';
import { GATEWAY_CLASS_ENVOY } from '../constants/internal.ts';

// ── Namespace ─────────────────────────────────────────────────────────────────

/** Dedicated namespace for the EG controller and the managed Envoy proxy fleet. */
export const ns = new k8s.core.v1.Namespace('envoy-gateway-system', {
  metadata: { name: 'envoy-gateway-system' },
});

// ── Helm release ──────────────────────────────────────────────────────────────
//
// Envoy Gateway is distributed as an OCI helm chart.
//   Chart:  oci://docker.io/envoyproxy/gateway-helm
//   Docs:   https://gateway.envoyproxy.io/docs/install/install-helm/
//   Values: https://github.com/envoyproxy/gateway/tree/main/charts/gateway-helm
//
// skipCrds is intentionally FALSE so this release installs:
//   • Gateway API CRDs — experimental channel (superset of standard; adds
//     TCPRoute, UDPRoute, BackendTLSPolicy, etc.)
//   • Envoy Gateway CRDs — EnvoyProxy, ClientTrafficPolicy,
//     BackendTrafficPolicy, EnvoyPatchPolicy, SecurityPolicy, …
//
// Because of this, index.ts skips the standalone gatewayApi.ts kustomize
// install when envoyGatewayEnabled=true to avoid CRD ownership conflicts.
// See: https://gateway.envoyproxy.io/docs/install/install-helm/#installing-crds-separately

export const release = new k8s.helm.v3.Release(
  'envoy-gateway',
  {
    chart: 'oci://docker.io/envoyproxy/gateway-helm',
    version: ENVOY_GATEWAY_VERSION,
    namespace: ns.metadata.name,
    skipCrds: false,
    values: {
      // ── Controller deployment ─────────────────────────────────────────────
      deployment: {
        replicas: 2,
        pod: {
          tolerations: [CAN_RUN_ON_SPOT],
          affinity: {
            nodeAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                { weight: 1, preference: RUN_ON_SPOT },
              ],
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [{ matchExpressions: [purposeAffinity('ingress')] }],
              },
            },
          },
          // Allow rolling updates to land on existing AZ nodes ([2,2] is fine),
          // while still guaranteeing spread across at least 2 AZs at steady state.
          topologySpreadConstraints: [
            {
              maxSkew: 1,
              minDomains: 2,
              topologyKey: 'topology.kubernetes.io/zone',
              whenUnsatisfiable: 'DoNotSchedule',
              labelSelector: {
                matchExpressions: [
                  { key: 'app.kubernetes.io/name', operator: 'In', values: ['envoy-gateway'] },
                ],
              },
            },
          ],
        },
        envoyGateway: {
          resources: {
            requests: { cpu: '100m', memory: '256Mi' },
            limits: { memory: '512Mi' },
          },
        },
      },

      // ── Controller PodDisruptionBudget ────────────────────────────────────
      podDisruptionBudget: { minAvailable: 1 },

      // ── Controller configuration ──────────────────────────────────────────
      // Full schema: https://gateway.envoyproxy.io/docs/api/extension_types/#envoygateway
      config: {
        envoyGateway: {
          gateway: {
            // Must match controllerName in the GatewayClass below.
            controllerName: 'gateway.envoyproxy.io/gatewayclass-controller',
          },
          logging: {
            level: { default: 'info' },
          },
          provider: {
            type: 'Kubernetes',
            kubernetes: {
              // Leader election is enabled by default; explicitly keep it on.
              leaderElection: { disable: false },
            },
          },
        },
      },
    },
  },
  { deleteBeforeReplace: true },
);

export const envoyProxy = new k8s.apiextensions.CustomResource(
  'envoy-proxy',
  {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'EnvoyProxy',
    metadata: {
      namespace: ns.metadata.name,
    },
    spec: {
      mergeGateways: true,
      provider: {
        type: 'Kubernetes',
        kubernetes: {
          envoyDeployment: {
            replicas: 2,
            strategy: {
              type: 'RollingUpdate',
              rollingUpdate: { maxUnavailable: 1, maxSurge: 1 },
            },
            pod: {
              labels: { 'bes.gateway.role': 'proxy' },
              tolerations: [CAN_RUN_ON_SPOT],
              affinity: {
                nodeAffinity: {
                  preferredDuringSchedulingIgnoredDuringExecution: [
                    { weight: 1, preference: RUN_ON_SPOT },
                  ],
                  requiredDuringSchedulingIgnoredDuringExecution: {
                    nodeSelectorTerms: [{ matchExpressions: [purposeAffinity('ingress')] }],
                  },
                },
              },
              // Allow rolling updates to land on existing AZ nodes ([2,2] is fine),
              // while still guaranteeing spread across at least 2 AZs at steady state.
              topologySpreadConstraints: [
                {
                  maxSkew: 1,
                  minDomains: 2,
                  topologyKey: 'topology.kubernetes.io/zone',
                  whenUnsatisfiable: 'DoNotSchedule',
                  labelSelector: {
                    matchExpressions: [
                      { key: 'bes.gateway.role', operator: 'In', values: ['proxy'] },
                    ],
                  },
                },
              ],
            },
            container: {
              resources: {
                requests: { cpu: '100m', memory: '512Mi' },
                limits: { memory: '1Gi' },
              },
            },
          },

          envoyPDB: { minAvailable: 1 },

          envoyService: {
            type: 'LoadBalancer',
            loadBalancerClass: 'service.k8s.aws/nlb',
            annotations: {
              'service.beta.kubernetes.io/aws-load-balancer-nlb-target-type': 'ip',
              'service.beta.kubernetes.io/aws-load-balancer-ip-address-type': 'dualstack',
              'service.beta.kubernetes.io/aws-load-balancer-scheme': 'internet-facing',
              'service.beta.kubernetes.io/aws-load-balancer-proxy-protocol': '*',
              'service.beta.kubernetes.io/aws-load-balancer-target-group-attributes':
                'preserve_client_ip.enabled=true',
              'service.beta.kubernetes.io/aws-load-balancer-attributes':
                'deletion_protection.enabled=true',
              'service.beta.kubernetes.io/aws-load-balancer-additional-resource-tags':
                clusterName.apply((name) =>
                  [
                    `Cluster=k8s-${name}`,
                    `EKSCluster=${name}`,
                    `Purpose=k8s-ingress`,
                    `k8s:cluster-name=${name}`,
                  ].join(','),
                ),
            },
            externalTrafficPolicy: 'Cluster',
            patch: {
              type: 'StrategicMerge',
              value: {
                spec: {
                  ipFamilyPolicy: 'SingleStack',
                  ipFamilies: ['IPv6'],
                },
              },
            },
          },
        },
      },
    },
  },
  { dependsOn: [release] },
);

export const gatewayClass = new k8s.apiextensions.CustomResource('envoy-gateway-class', {
  apiVersion: 'gateway.networking.k8s.io/v1',
  kind: 'GatewayClass',
  metadata: { name: GATEWAY_CLASS_ENVOY },
  spec: {
    controllerName: 'gateway.envoyproxy.io/gatewayclass-controller',
    parametersRef: {
      group: 'gateway.envoyproxy.io',
      kind: 'EnvoyProxy',
      name: envoyProxy.metadata.name,
      namespace: ns.metadata.name,
    },
  },
});
