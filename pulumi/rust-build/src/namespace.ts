import * as k8s from '@pulumi/kubernetes';

// The builder provisioning script (setup.sh) is not shipped here: cargo-bescloud
// embeds it and pipes it into the pod over exec, so it can be templated per
// invocation (targets, apt deps, appended files) without a redeploy.
export const ns = new k8s.core.v1.Namespace('rust-build', {
  metadata: { name: 'rust-build' },
});
export const namespace = ns.metadata.name;
