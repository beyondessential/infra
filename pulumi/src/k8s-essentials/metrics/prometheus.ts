import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

new k8s.helm.v3.Release(
  'prometheus',
  {
    name: 'prometheus',
    chart: 'prometheus',
    version: '25.27.0',
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
        replicaCount: 1,
        statefulSet: {
          enabled: true,
        },
        persistentVolume: {
          size: '50Gi',
        },
        affinity: {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    { key: 'bes.node.purpose', operator: 'In', values: ['system'] },
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
