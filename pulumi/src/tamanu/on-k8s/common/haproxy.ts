import { ComponentResource, Input, all, interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';
import { RUN_ON_SPOT, purposeAffinity } from '../../../common/k8s/affinities.js';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';

export interface RunHaproxyArgs {
  parent: ComponentResource;
  labels: { [key: string]: string };
  servers: HaproxyServerArgs[];
  serviceName?: string;
  replicas?: number;
}

export interface RunHaproxyOutput {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
}

export function runHaproxy(
  name: string,
  { parent, labels: argLabels, servers, serviceName, replicas }: RunHaproxyArgs,
): RunHaproxyOutput {
  const labels = {
    ...argLabels,
    'app.kubernetes.io/component': 'load-balancer',
  };

  const config = new k8s.core.v1.ConfigMap(
    `${name}-haproxy`,
    {
      metadata: {
        namespace,
        labels,
      },
      data: {
        'haproxy.cfg': all([
          BASE,
          STATS,
          ...servers.map(({ port }) => httpFrontend(port)),
          ...servers.map(httpBackend),
          '', // trailing newline required for config to be valid
        ]).apply((blocks) => blocks.join('\n\n')),
      },
    },
    { parent },
  );

  const service = new k8s.core.v1.Service(
    `${name}-lb`,
    {
      metadata: {
        namespace,
        name: serviceName,
      },
      spec: {
        ports: [
          ...servers.map(({ name, port }) => ({
            protocol: 'TCP',
            port,
            targetPort: name,
            name,
          })),
          {
            protocol: 'TCP',
            port: 81,
            targetPort: 'status',
            name,
          },
        ],
        selector: labels,
        clusterIP: 'None',
      },
    },
    { parent, replaceOnChanges: ['clusterIP'], deleteBeforeReplace: !!serviceName },
  );

  const deployment = new k8s.apps.v1.Deployment(
    `${name}-haproxy`,
    {
      metadata: {
        namespace,
      },
      spec: {
        replicas,
        selector: {
          matchLabels: labels,
        },
        template: {
          metadata: {
            labels,
          },
          spec: {
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
                      matchExpressions: [purposeAffinity('workload')],
                    },
                  ],
                },
              },
            },
            volumes: [
              {
                name: 'config-volume',
                configMap: {
                  name: config.metadata.name,
                },
              },
            ],
            containers: [
              {
                name: 'haproxy',
                image: 'haproxytech/haproxy-alpine:2.7',
                imagePullPolicy: 'IfNotPresent',
                args: ['-f', '/usr/local/etc/haproxy/vol/haproxy.cfg'],
                volumeMounts: [
                  {
                    name: 'config-volume',
                    mountPath: '/usr/local/etc/haproxy/vol',
                  },
                ],
                resources: {
                  requests: {
                    cpu: '15m',
                    memory: '10Mi',
                  },
                  limits: {
                    cpu: '75m',
                    memory: '50Mi',
                  },
                },
                ports: [
                  ...servers.map(({ name, port }) => ({
                    containerPort: port,
                    name,
                  })),
                  {
                    containerPort: 81,
                    name: 'status',
                  },
                ],
                livenessProbe: {
                  periodSeconds: 10,
                  failureThreshold: 2,
                  httpGet: {
                    path: '/ready',
                    port: 81,
                  },
                },
              },
            ],
          },
        },
      },
    },
    { parent },
  );

  return { deployment, service };
}

const BASE = `
global
  log         stderr local7

  chroot      /var/lib/haproxy
  pidfile     /var/run/haproxy.pid
  maxconn     4000
  user        haproxy
  group       haproxy

defaults
  mode                    http
  log                     global

  option                  httplog
  option                  dontlognull
  option                  http-server-close
  option                  redispatch

  retries                 3
  timeout http-request    10s
  timeout queue           1m
  timeout connect         10s
  timeout client          1m
  timeout server          1m
  timeout http-keep-alive 10s
  timeout check           10s
  maxconn                 3000

resolvers systemdns
  parse-resolv-conf
  hold valid 10s
  accepted_payload_size 8192

backend http404
  mode http
  http-request deny deny_status 404
`.trim();

const STATS = `
frontend stats
  bind :::81
  mode http
  default_backend stats
  use_backend http200 if { path_beg /ready }

backend http200
  mode http
  http-request deny deny_status 200

backend stats
  stats enable
  stats uri /
  stats auth admin:password
  stats admin if TRUE
`.trim();

const httpFrontend = (port: number) =>
  `frontend http
    bind :::${port}
    mode http
    default_backend http404
    use_backend back${port}
  `.trim();

export interface HaproxyServerArgs {
  port: number;
  name: string;
  maxBackends: number;
  serviceName: Input<string>;
  serviceProtocol?: 'tcp' | 'udp';
  servicePortName?: string;
}

const SVC = 'svc.cluster.local';
const httpBackend = ({
  port,
  name,
  maxBackends,
  serviceName,
  servicePortName,
  serviceProtocol,
}: HaproxyServerArgs) =>
  interpolate`
    backend back${port}
      mode http
      option httpchk GET /
      option http-keep-alive
      balance leastconn
      server-template ${name} 1-${haproxyBackends(maxBackends)} \
        _${servicePortName}._${serviceProtocol ?? 'tcp'}.${serviceName}.${namespace}.${SVC} \
        resolvers systemdns \
        resolve-prefer ipv6 \
        init-addr none \
        check
  `;

function haproxyBackends(n: number) {
  return Math.floor(10 * Math.max(1, 1 + Math.floor((n * 1.2) / 10)));
}
