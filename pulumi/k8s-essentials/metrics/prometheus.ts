import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { PROMETHEUS_VERSION } from '../versions.ts';

new k8s.helm.v3.Release(
  'prometheus',
  {
    name: 'prometheus',
    chart: 'prometheus',
    version: PROMETHEUS_VERSION,
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
        // Must stay below the volume size: on a full disk the WAL can't open
        // and the server crashloops instead of pruning.
        retentionSize: '40GB',
        statefulSet: {
          enabled: true,
        },
        persistentVolume: {
          size: '50Gi',
        },
        resources: {
          requests: {
            cpu: '1000m',
            memory: '4Gi',
          },
          limits: {
            cpu: '2000m',
            memory: '12Gi',
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
