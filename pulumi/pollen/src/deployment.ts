import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { labels } from './labels.ts';
import { migrator } from './migrator.ts';
import { appSecret } from './secrets.ts';
import { scheduling, databaseUrlEnv } from './pod.ts';
import {
  image,
  replicas,
  publicBaseUrl,
  rulesetRepo,
  cpuRequest,
  memoryRequest,
} from './config.ts';

const env: k8s.types.input.core.v1.EnvVar[] = [
  databaseUrlEnv,
  { name: 'PUBLIC_BASE_URL', value: publicBaseUrl },
  ...(rulesetRepo ? [{ name: 'RULESET_REPO', value: rulesetRepo }] : []),
  ...(appSecret
    ? [
        {
          name: 'RULESET_REPO_TOKEN',
          valueFrom: {
            secretKeyRef: {
              name: appSecret.metadata.name,
              key: 'RULESET_REPO_TOKEN',
            },
          },
        },
      ]
    : []),
];

export const deployment = new k8s.apps.v1.Deployment(
  'pollen-server',
  {
    metadata: {
      namespace,
      name: 'pollen', // pinned so pulumi updates in place rather than replacing
      labels,
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
          ...scheduling,
          containers: [
            {
              name: 'server',
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [
                {
                  containerPort: 8000,
                  name: 'http',
                },
              ],
              env,
              // Wait up to 60 seconds for the server to start...
              startupProbe: {
                periodSeconds: 1,
                failureThreshold: 60,
                httpGet: {
                  path: '/livez',
                  port: 8000,
                  scheme: 'HTTP',
                },
              },
              // ...then continuously check it, restarting if it stops responding
              livenessProbe: {
                periodSeconds: 10,
                failureThreshold: 3,
                httpGet: {
                  path: '/livez',
                  port: 8000,
                  scheme: 'HTTP',
                },
              },
              readinessProbe: {
                periodSeconds: 10,
                httpGet: {
                  path: '/healthz',
                  port: 8000,
                  scheme: 'HTTP',
                },
              },
              resources: {
                requests: {
                  cpu: cpuRequest,
                  memory: memoryRequest,
                },
              },
            },
          ],
        },
      },
    },
  },
  { dependsOn: [migrator] },
);
