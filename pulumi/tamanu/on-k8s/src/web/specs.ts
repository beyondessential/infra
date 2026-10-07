import { compact } from 'lodash-es';
import * as k8s from '@pulumi/kubernetes';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../../common/k8s/tolerations.ts';
import type { PodSpecArgs, PodSpecFactory } from '../common/specFactory.ts';
import { architecture, nodeEnv } from '../config.ts';
import { type ImageType, image, imageTag } from '../image.ts';

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

export function podSpecFactory(imageType: ImageType): PodSpecFactory {
  return ({
    podType,
    containerArgs: { volumeMounts = [], ...containerArgs } = {},
    volumes = [],
    env = [],
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
              matchExpressions: [archAffinity(architecture), purposeAffinity('workload')],
            },
          ],
        },
      },
    },
    volumes,
    containers: [
      {
        name: podType,
        image: image(imageType),
        imagePullPolicy: 'IfNotPresent',
        volumeMounts,
        env: compact([
          ...env,
          {
            name: 'NODE_ENV',
            value: nodeEnv,
          },
          imageTag.startsWith('sha-') && {
            name: 'REVISION',
            value: imageTag.replace(/^sha-/, '').slice(0, 10),
          },
          {
            name: 'BUGSNAG_API_KEY',
            valueFrom: {
              secretKeyRef: {
                name: 'bugsnag',
                key: 'apiKey',
              },
            },
          },
        ]),
        resources: {
          requests: {
            cpu: '1m',
            memory: '10Mi',
          },
          // No CPU limit: a 10m quota throttled asset serving in ~12% of periods.
          limits: {
            memory: '100Mi',
          },
        },
        ...containerArgs,
      },
    ],
  });
}
