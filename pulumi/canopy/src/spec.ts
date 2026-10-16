import * as k8s from '@pulumi/kubernetes';
import { architecture } from './config.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { PostgresUrlSecretKey } from '../../common/k8s/postgresUrl.ts';

import { image } from './image.ts';
import './ca.ts';
import { dbReady } from './db.ts';
import { dnsZones } from './dns-zones.ts';
import { POOLER_RO_HOST, POOLER_RW_HOST } from './pooler.ts';
import { all, type Input } from '@pulumi/pulumi';

export function spec(
  name: string,
  command: string[] = [],
  containerArgs: Partial<k8s.types.input.core.v1.Container> = {},
  // `pooled` connects through PgBouncer, for long-running services; jobs keep
  // direct connections (see pooler.ts).
  podArgs: { serviceAccountName?: Input<string>; pooled?: boolean } = {},
): k8s.types.input.core.v1.PodSpec {
  const secretKey = (key: string) => ({
    secretKeyRef: dbReady.apply((url) => ({ name: url.metadata.name, key })),
  });
  // The pooler URLs mirror the direct ones in postgresUrl.ts with only the host
  // changed, filled in from the password by the kubelet's $(VAR) expansion.
  const dbEnv = podArgs.pooled
    ? [
        { name: 'DB_APP_PASSWORD', valueFrom: secretKey(PostgresUrlSecretKey.AppPassword) },
        { name: 'DATABASE_URL', value: `postgres://app:$(DB_APP_PASSWORD)@${POOLER_RW_HOST}/app` },
        {
          name: 'RO_DATABASE_URL',
          value: `postgres://app:$(DB_APP_PASSWORD)@${POOLER_RO_HOST}/app?sslmode=disable`,
        },
      ]
    : [
        { name: 'DATABASE_URL', valueFrom: secretKey(PostgresUrlSecretKey.AppDbUrl) },
        { name: 'RO_DATABASE_URL', valueFrom: secretKey(PostgresUrlSecretKey.AppRoDbUrl) },
      ];

  return {
    ...(podArgs.serviceAccountName ? { serviceAccountName: podArgs.serviceAccountName } : {}),
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
              matchExpressions: [archAffinity(architecture), purposeAffinity('workload')],
            },
          ],
        },
      },
    },
    containers: [
      {
        ...containerArgs,
        image: image(),
        imagePullPolicy: 'IfNotPresent',
        name,
        args: command,
        ports: [
          {
            containerPort: 8000,
            name: 'http',
          },
        ],
        env: all([containerArgs.env]).apply(([extraEnv]) => [
          {
            name: 'BIND_ADDRESS',
            value: '[::]:8000',
          },
          ...dbEnv,
          // Every workload, not only the domains pod that writes the records:
          // private-server answers which zones are claimable into, public-server
          // gates a server's name entitlements on them, and the monitor reports a
          // group domain no configured zone covers.
          // spec: CTLS#managed-zones
          ...(dnsZones ? [{ name: 'CANOPY_DNS_ZONES', value: dnsZones }] : []),
          ...(extraEnv ?? []),
        ]),
        resources: {
          requests: {
            cpu: '2m',
            memory: '10Mi',
          },
        },
      },
    ],
  };
}
