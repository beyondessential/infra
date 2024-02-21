import { Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { ImageType, image, imageTag } from '../image.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../common/k8s/affinities.js';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';
import { PodSpecArgs, PodSpecFactory, podSpreadAntiAffinity } from '../common/specFactory.js';

export type ServerType = Exclude<ImageType, 'frontend'>;

export function appSelector(serverType: ServerType, instance?: string): { [key: string]: string } {
  const selector = {
    'app.kubernetes.io/name': serverType as string,
    'app.kubernetes.io/component': 'web',
  };

  if (instance) {
    selector['app.kubernetes.io/instance'] = instance;
  }

  return selector;
}

export function appLabels(serverType: ServerType, instance?: string): { [key: string]: string } {
  return {
    ...appSelector(serverType, instance),
    'app.kubernetes.io/version': imageTag,
  };
}

export function podSpecFactory(): PodSpecFactory {
  return ({
    podType,
    podSpreadSelector,
    containerArgs: { volumeMounts = [], ...containerArgs } = {},
    volumes = [],
  }: PodSpecArgs): k8s.types.input.core.v1.PodSpec => ({
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
              matchExpressions: [archAffinity('amd64'), purposeAffinity('workload')],
            },
          ],
        },
      },
      podAntiAffinity: podSpreadAntiAffinity(podSpreadSelector),
    },
    volumes,
    containers: [
      {
        name: podType,
        image: image('frontend'),
        imagePullPolicy: 'IfNotPresent',
        volumeMounts,
        resources: {
          requests: {
            cpu: '1m',
            memory: '10Mi',
          },
          limits: {
            cpu: '10m',
            memory: '100Mi',
          },
        },
        ...containerArgs,
      },
    ],
  });
}
