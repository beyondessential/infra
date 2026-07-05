import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { role } from './artifacts.ts';

// IRSA: builder pods assume this stack's own `rust-build` role (scoped S3 access
// to the artifacts bucket) via this annotated service account, so they can
// upload artifacts for the client to download out-of-band (the exec channel
// drops the tail of large streams).
export const serviceAccount = new k8s.core.v1.ServiceAccount('rust-build', {
  metadata: {
    namespace,
    name: 'rust-build',
    annotations: { 'eks.amazonaws.com/role-arn': role.arn },
  },
});
