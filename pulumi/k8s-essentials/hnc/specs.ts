// Converted from HNC v1.1.0 default-cm.yaml
import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../../common/k8s/affinities.ts';
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
              // Upstream ships an amd64-only image, but the source is pure
              // CGO-disabled Go and cross-compiles cleanly. The init container
              // below builds for the node's native arch on each pod start.
              matchExpressions: [purposeAffinity('system')],
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
    initContainers: [
      {
        name: 'build',
        // Debian-based golang image ships git pre-installed, so this works
        // under the pod-level non-root securityContext without needing apk.
        image: 'golang:1.21',
        command: ['sh', '-ec'],
        args: [
          [
            `git clone --depth 1 -b v${HNC_VERSION} https://github.com/kubernetes-sigs/hierarchical-namespaces.git /tmp/src`,
            'cd /tmp/src',
            'CGO_ENABLED=0 go build -o /hnc-bin/manager ./cmd/manager/main.go',
          ].join(' && '),
        ],
        env: [
          // Pod runs as UID 1000, which has no $HOME in this image; point Go's
          // build cache somewhere writable.
          { name: 'HOME', value: '/tmp' },
          { name: 'GOCACHE', value: '/tmp/.cache/go-build' },
        ],
        resources: {
          requests: { cpu: '500m', memory: '1Gi' },
          limits: { memory: '2Gi' },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ['ALL'] },
          seccompProfile: { type: 'RuntimeDefault' },
        },
        volumeMounts: [
          {
            mountPath: '/hnc-bin',
            name: 'hnc-bin',
          },
        ],
      },
    ],
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
        command: ['/hnc-bin/manager'],
        image: 'gcr.io/distroless/static:nonroot',
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
          {
            mountPath: '/hnc-bin',
            name: 'hnc-bin',
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
      {
        name: 'hnc-bin',
        emptyDir: {},
      },
    ],
  };
}
