// Converted from HNC v1.1.0 default-cm.yaml
import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../common/k8s/affinities.ts';
import { HNC_VERSION } from '../versions.ts';
import { SERVING_CERT_SECRET_NAME } from './cert.ts';

export function hncSpec(args: string[], podSpreadSelector?: { [key: string]: string }): k8s.types.input.core.v1.PodSpec {
  return {
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
              // No ARM64 support: https://github.com/kubernetes-sigs/hierarchical-namespaces/issues/201
              matchExpressions: [archAffinity('amd64'), purposeAffinity('system')],
            },
          ],
        },
      },
      podAntiAffinity: podSpreadSelector ? {
        // spread out across AZs
        requiredDuringSchedulingIgnoredDuringExecution: [
          {
            labelSelector: {
              matchExpressions: [
                ...Object.entries(podSpreadSelector).map(([key, value]) => ({
                  key,
                  operator: 'In',
                  values: [value],
                })),
              ],
            },
            topologyKey: 'topology.kubernetes.io/zone',
          },
        ],
      } : {},
    },
    containers: [
      {
        args: [
          '--webhook-server-port=9443',
          '--metrics-addr=:8080',
          '--max-reconciles=10',
          '--apiserver-qps-throttle=50',
          '--excluded-namespace=kube-system',
          '--excluded-namespace=kube-public',
          '--excluded-namespace=hnc-system',
          '--excluded-namespace=kube-node-lease',
          '--nopropagation-label=cattle.io/creator=norman',
          ...args,
        ],
        command: ['/manager'],
        image: `gcr.io/k8s-staging-multitenancy/hnc-manager:v${HNC_VERSION}`,
        livenessProbe: {
          failureThreshold: 1,
          httpGet: {
            path: '/healthz',
            port: 8081,
          },
          periodSeconds: 10,
        },
        name: 'manager',
        ports: [
          {
            containerPort: 9443,
            name: 'webhook-server',
            protocol: 'TCP',
          },
          {
            containerPort: 8080,
            name: 'metrics',
            protocol: 'TCP',
          },
          {
            containerPort: 8081,
            name: 'healthz',
            protocol: 'TCP',
          },
        ],
        readinessProbe: {
          httpGet: {
            path: '/readyz',
            port: 8081,
          },
          periodSeconds: 5,
        },
        resources: {
          limits: {
            cpu: '100m',
            memory: '300Mi',
          },
          requests: {
            cpu: '100m',
            memory: '150Mi',
          },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: {
            drop: ['ALL'],
          },
          readOnlyRootFilesystem: true,
          runAsNonRoot: true,
          seccompProfile: {
            type: 'RuntimeDefault',
          },
        },
        startupProbe: {
          failureThreshold: 100,
          httpGet: {
            path: '/readyz',
            port: 8081,
          },
          periodSeconds: 5,
        },
        volumeMounts: [
          {
            mountPath: '/tmp/k8s-webhook-server/serving-certs',
            name: 'cert',
            readOnly: true,
          },
        ],
      },
    ],
    securityContext: {
      fsGroup: 2000,
      runAsNonRoot: true,
      runAsUser: 1000,
    },
    terminationGracePeriodSeconds: 10,
    volumes: [
      {
        name: 'cert',
        secret: {
          defaultMode: 420,
          secretName: SERVING_CERT_SECRET_NAME,
        },
      },
    ],
  };
}
