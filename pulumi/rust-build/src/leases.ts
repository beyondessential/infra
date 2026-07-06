import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { architectures, archSeg, maxBuilders, leaseDurationSeconds } from './config.ts';

// One slot Lease per (arch, ordinal) — the concurrency locks the client wrapper
// CAS-acquires and heartbeats (renewTime). Names line up with the StatefulSet
// pod ordinals: rust-build-<seg>-<i>.
//
// Pulumi declares their existence but ignores spec drift: the wrapper mutates
// holderIdentity/renewTime at runtime, and a `pulumi up` must not reset a lease
// that an in-flight build currently holds.
export const leases = architectures.flatMap((arch) =>
  Array.from({ length: maxBuilders }, (_, i) => {
    const name = `rust-build-${archSeg[arch]}-${i}`;
    return new k8s.coordination.v1.Lease(
      name,
      {
        metadata: { namespace, name },
        spec: { leaseDurationSeconds },
      },
      { ignoreChanges: ['spec'] },
    );
  }),
);
