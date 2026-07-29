import * as k8s from '@pulumi/kubernetes';
import { EG_API_GROUP } from '../common/k8s/gateway/consts/API.ts';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../common/k8s/affinities.ts';
import { clusterName } from '../common/k8s/coreRef.ts';
import { ENVOY_GATEWAY_VERSION, GATEWAY_API_VERSION } from './versions.ts';
import { GATEWAY_CLASS_ENVOY } from '../constants/internal.ts';
import { failIfGatewayApiTooOld } from './gatewayApiVersion.ts';

// Helm never upgrades a chart's crds/, so the Gateway API CRDs do not move when
// the controller does. Check before deploying rather than discovering it as a
// release that times out while the new controller crash-loops on a missing kind.
await failIfGatewayApiTooOld(GATEWAY_API_VERSION, ENVOY_GATEWAY_VERSION);

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
      ipFamily: 'IPv6',
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

              'service.beta.kubernetes.io/aws-load-balancer-enable-prefix-for-ipv6-source-nat':
                'on', // enable UDP
              // Create a TCP_UDP listener so the NLB forwards both TCP (HTTPS/HTTP2) and
              // UDP (QUIC/HTTP3) traffic to the same Envoy target group on port 10443.
              // Without this the LBC silently ignores the UDP service port and only
              // creates a TCP listener. Requires LBC >= v2.13.0.
              'service.beta.kubernetes.io/aws-load-balancer-enable-tcp-udp-listener': 'true',
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

// ── Admission policy ──────────────────────────────────────────────────────────
//
// With mergeGateways=true, all gateways share a single Envoy deployment and
// Service. Envoy Gateway only adds the UDP port (needed for QUIC/HTTP3) to the
// Service when ALL merged gateways consistently have http3 enabled. A single
// ClientTrafficPolicy without http3 silently breaks HTTP/3 for every gateway.
//
// This ValidatingAdmissionPolicy (CEL, GA since k8s 1.28) rejects any
// ClientTrafficPolicy that is missing spec.http3 at create/update time, turning
// that silent runtime failure into a loud deploy-time error.

const http3Policy = new k8s.apiextensions.CustomResource('envoy-gateway-require-http3-policy', {
  apiVersion: 'admissionregistration.k8s.io/v1',
  kind: 'ValidatingAdmissionPolicy',
  metadata: {
    name: 'require-http3-clienttrafficpolicy.gateway.envoyproxy.io',
  },
  spec: {
    failurePolicy: 'Fail',
    matchConstraints: {
      resourceRules: [
        {
          apiGroups: [EG_API_GROUP],
          apiVersions: ['*'],
          operations: ['CREATE', 'UPDATE'],
          resources: ['clienttrafficpolicies'],
        },
      ],
    },
    validations: [
      {
        expression: 'has(object.spec.http3)',
        message:
          'ClientTrafficPolicy must set spec.http3 — all merged gateways must enable HTTP/3 ' +
          'consistently, otherwise Envoy Gateway will not add a UDP port to the shared Service ' +
          'and HTTP/3 will silently break for every gateway in the cluster.',
      },
      {
        expression:
          '!has(object.spec.enableProxyProtocol) || object.spec.enableProxyProtocol == false',
        message:
          'ClientTrafficPolicy must not set spec.enableProxyProtocol — the proxy_protocol ' +
          'listener filter is TCP-only and Envoy rejects any QUIC listener that has it attached, ' +
          'breaking HTTP/3. Client IP is preserved at the IP layer via preserve_client_ip.enabled ' +
          'on the NLB target group instead.',
      },
    ],
  },
});

new k8s.apiextensions.CustomResource(
  'envoy-gateway-require-http3-policy-binding',
  {
    apiVersion: 'admissionregistration.k8s.io/v1',
    kind: 'ValidatingAdmissionPolicyBinding',
    metadata: {
      name: 'require-http3-clienttrafficpolicy.gateway.envoyproxy.io',
    },
    spec: {
      policyName: http3Policy.metadata.name,
      validationActions: ['Deny'],
    },
  },
  { dependsOn: [http3Policy] },
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
