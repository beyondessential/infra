import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../common/k8s/affinities.ts';
import { clusterName } from '../common/k8s/coreRef.ts';
import { ENVOY_GATEWAY_VERSION } from './versions.ts';

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
            // Spread controller replicas across AZs.
            podAntiAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: [
                {
                  labelSelector: {
                    matchExpressions: [
                      { key: 'app.kubernetes.io/name', operator: 'In', values: ['envoy-gateway'] },
                    ],
                  },
                  topologyKey: 'topology.kubernetes.io/zone',
                },
              ],
            },
          },
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

// ── EnvoyProxy ────────────────────────────────────────────────────────────────
//
// EnvoyProxy configures the Envoy data-plane fleet that EG deploys per Gateway.
// Referenced by GatewayClass.spec.parametersRef so every Gateway using the
// 'envoy-gateway' class inherits this infrastructure configuration.
//
// Key responsibilities:
//   • NLB provisioning via AWS LBC annotations on the managed Service.
//     This creates a *separate* NLB from nginx, letting both coexist during
//     the migration period.
//   • Proxy pod scheduling: ingress-node affinity + spot toleration (mirrors nginx).
//   • Resource requests sized to match the nginx controller pods.

export const envoyProxy = new k8s.apiextensions.CustomResource(
  'envoy-proxy',
  {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'EnvoyProxy',
    metadata: {
      namespace: ns.metadata.name,
    },
    spec: {
      provider: {
        type: 'Kubernetes',
        kubernetes: {
          // ── Proxy deployment ────────────────────────────────────────────────
          envoyDeployment: {
            replicas: 2,
            strategy: {
              type: 'RollingUpdate',
              rollingUpdate: { maxUnavailable: 1, maxSurge: 1 },
            },
            pod: {
              // Custom label for the zone anti-affinity rule below.
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
                // Hard requirement: one proxy pod per AZ.
                podAntiAffinity: {
                  requiredDuringSchedulingIgnoredDuringExecution: [
                    {
                      labelSelector: {
                        matchExpressions: [
                          { key: 'bes.gateway.role', operator: 'In', values: ['proxy'] },
                        ],
                      },
                      topologyKey: 'topology.kubernetes.io/zone',
                    },
                  ],
                },
              },
            },
            container: {
              resources: {
                requests: { cpu: '100m', memory: '512Mi' },
                limits: { memory: '1Gi' },
              },
            },
          },

          // ── Proxy PodDisruptionBudget ───────────────────────────────────────
          envoyPDB: { minAvailable: 1 },

          // ── Managed Service + AWS NLB provisioning ─────────────────────────
          //
          // EG creates a Kubernetes Service for each Gateway; the annotations
          // below cause the AWS Load Balancer Controller (k8s-core) to back
          // that Service with an internet-facing NLB.
          //
          // Annotation semantics:
          //   aws-load-balancer-type: external
          //     → NLB (not ALB)
          //   aws-load-balancer-nlb-target-type: ip
          //     → route directly to pod IPs (no NodePort hop)
          //   aws-load-balancer-ip-address-type: dualstack
          //     → NLB has both IPv4 and IPv6 inbound addresses
          //   aws-load-balancer-scheme: internet-facing
          //     → public NLB
          //   aws-load-balancer-proxy-protocol: *
          //     → NLB sends Proxy Protocol v2 on ALL listeners; must be paired
          //       with the ClientTrafficPolicy below so EG reads it correctly
          //   preserve_client_ip.enabled=true
          //     → real source IP preserved at the target-group level
          //   deletion_protection.enabled=true
          //     → guard against accidental NLB deletion via terraform/console
          //
          // ipFamilyPolicy/ipFamilies: set via `patch` below (not directly
          //   exposed by EnvoyProxyKubernetesProvider). The Service is IPv6-only
          //   so the NLB registers pod IPv6 addresses as targets. The NLB still
          //   accepts both IPv4 and IPv6 inbound via ip-address-type=dualstack.
          //   This mirrors the nginx NLB configuration exactly.
          envoyService: {
            annotations: {
              'service.beta.kubernetes.io/aws-load-balancer-type': 'external',
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
                    `Purpose=k8s-envoy-ingress`,
                    `k8s:cluster-name=${name}`,
                  ].join(','),
                ),
            },
            // externalTrafficPolicy: Local preserves the client source IP at the
            // node level (pairs with ip-mode=ip targeting above for full fidelity).
            externalTrafficPolicy: 'Local',
            // Patch the underlying Service spec for fields not exposed by the CRD.
            // StrategicMerge is the default merge strategy for Services.
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

// ── GatewayClass ──────────────────────────────────────────────────────────────
//
// GatewayClass tells the Gateway API which controller owns Gateways of this
// class, and points to the EnvoyProxy resource that sets the proxy fleet config
// (NLB, scheduling, resources).  This is cluster-scoped.

export const gatewayClass = new k8s.apiextensions.CustomResource('envoy-gateway-class', {
  apiVersion: 'gateway.networking.k8s.io/v1',
  kind: 'GatewayClass',
  metadata: { name: 'envoy-gateway' },
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
