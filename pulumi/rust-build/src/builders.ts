import * as k8s from '@pulumi/kubernetes';
import { archAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';
import { region } from '../../common/k8s/coreRef.ts';
import { namespace } from './namespace.ts';
import { bucket } from './artifacts.ts';
import { serviceAccount } from './serviceAccount.ts';
import { BUILD_TAINT } from './pools.ts';
import { architectures, archSeg, image, volumeSize, cpuRequest, memoryRequest } from './config.ts';

// Explicit PATH so both the image's cargo (/usr/local/cargo/bin) and tools
// cargo-installed into the persisted CARGO_HOME (/cache/cargo/bin) are found.
const PATH =
  '/cache/cargo/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

function builder(arch: Architecture) {
  const name = `rust-build-${archSeg[arch]}`;
  const labels = { 'app.kubernetes.io/name': name };

  // Headless service: StatefulSets require a serviceName; we only ever address
  // pods by ordinal name via kubectl exec, so it's a no-op governor.
  new k8s.core.v1.Service(name, {
    metadata: { namespace, name },
    spec: { clusterIP: 'None', selector: labels, ports: [{ name: 'noop', port: 1 }] },
  });

  new k8s.apps.v1.StatefulSet(
    name,
    {
      metadata: { namespace, name },
      spec: {
        serviceName: name,
        // Resting state is 0; the client wrapper scales 0..maxBuilders as it
        // claims slots. ignoreChanges below keeps `pulumi up` from resetting a
        // count the wrapper has raised for in-flight builds.
        replicas: 0,
        podManagementPolicy: 'Parallel',
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            // IRSA identity for uploading artifacts to the S3 bucket.
            serviceAccountName: serviceAccount.metadata.name,
            tolerations: [
              CAN_RUN_ON_SPOT,
              {
                key: BUILD_TAINT.key,
                operator: 'Equal',
                value: BUILD_TAINT.value,
                effect: 'NoSchedule',
              },
            ],
            affinity: {
              nodeAffinity: {
                preferredDuringSchedulingIgnoredDuringExecution: [
                  { weight: 1, preference: RUN_ON_SPOT },
                ],
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms: [
                    {
                      matchExpressions: [
                        { key: 'bes.node.purpose', operator: 'In', values: ['build'] },
                        archAffinity(arch),
                      ],
                    },
                  ],
                },
              },
            },
            terminationGracePeriodSeconds: 10,
            containers: [
              {
                name: 'builder',
                image,
                command: ['sleep', 'infinity'],
                env: [
                  { name: 'CARGO_HOME', value: '/cache/cargo' },
                  { name: 'SCCACHE_DIR', value: '/cache/sccache' },
                  // git deps (e.g. some workspaces) fetch more reliably via the
                  // git CLI than cargo's built-in libgit2 fetcher.
                  { name: 'CARGO_NET_GIT_FETCH_WITH_CLI', value: 'true' },
                  { name: 'PATH', value: PATH },
                  // Out-of-band artifact upload target (see cargo-bescloud).
                  { name: 'BESCLOUD_S3_BUCKET', value: bucket.bucket },
                  { name: 'AWS_DEFAULT_REGION', value: region },
                ],
                resources: { requests: { cpu: cpuRequest, memory: memoryRequest } },
                volumeMounts: [{ name: 'cache', mountPath: '/cache' }],
              },
            ],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: 'cache' },
            spec: {
              accessModes: ['ReadWriteOnce'],
              storageClassName: 'ebs-gp3',
              resources: { requests: { storage: volumeSize } },
            },
          },
        ],
      },
    },
    { ignoreChanges: ['spec.replicas'] },
  );
}

for (const arch of architectures) builder(arch);
