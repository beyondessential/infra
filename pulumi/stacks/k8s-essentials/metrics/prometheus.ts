import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

new k8s.helm.v3.Release(
  'prometheus',
  {
    name: 'prometheus',
    chart: 'prometheus',
    version: '27.28.0',
    repositoryOpts: {
      repo: 'https://prometheus-community.github.io/helm-charts',
    },
    namespace,
    values: {
      alertmanager: {
        enabled: false,
      },
      'prometheus-pushgateway': {
        enabled: false,
      },
      server: {
        // This MUST be 1 in the current setup!
        // 2+ means that stats are duplicated, which makes the metrics
        // display as doubled in e.g. headlamp or other monitors.
        replicaCount: 1,
        statefulSet: {
          enabled: true,
        },
        persistentVolume: {
          size: '50Gi',
        },
        resources: {
          requests: {
            cpu: '1000m',
            memory: '2000Mi',
          },
          limits: {
            cpu: '2000m',
            memory: '5000Mi',
          },
        },
        affinity: {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    { key: 'bes.node.purpose', operator: 'In', values: ['workload'] },
                  ],
                },
              ],
            },
          },
          podAntiAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: [
              {
                labelSelector: {
                  matchExpressions: [
                    {
                      key: 'app.kubernetes.io/name',
                      operator: 'In',
                      values: ['prometheus'],
                    },
                  ],
                },
                topologyKey: 'topology.kubernetes.io/zone',
              },
            ],
          },
        },
      },
    },
  },
  {
    deleteBeforeReplace: true,
  },
);
