import { Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { ImageType, image, imageTag } from '../image.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../common/k8s/affinities.js';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';

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

export type PodSpecFactory = (
  containerArgs?: Partial<k8s.types.input.core.v1.Container>,
  volumes?: Input<k8s.types.input.core.v1.Volume>[],
) => k8s.types.input.core.v1.PodSpec;

export function podSpecFactory(): PodSpecFactory {
  return (
    { volumeMounts = [], ...containerArgs }: Partial<k8s.types.input.core.v1.Container> = {},
    volumes: Input<k8s.types.input.core.v1.Volume>[] = [],
  ): k8s.types.input.core.v1.PodSpec => ({
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
    },
    volumes,
    containers: [
      {
        name: 'web',
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
