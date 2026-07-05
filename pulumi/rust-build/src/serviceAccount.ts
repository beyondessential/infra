import * as k8s from '@pulumi/kubernetes';
import { $core } from '../../common/k8s/coreRef.ts';
import { namespace } from './namespace.ts';

// IRSA: builder pods assume the k8s-core `rust-build` role (scoped S3 access to
// the artifacts bucket) via this annotated service account, so they can upload
// artifacts for the client to download out-of-band (the exec channel drops the
// tail of large streams).
export const serviceAccount = new k8s.core.v1.ServiceAccount('rust-build', {
  metadata: {
    namespace,
    name: 'rust-build',
    annotations: { 'eks.amazonaws.com/role-arn': $core.rustBuildRoleArn },
  },
});
