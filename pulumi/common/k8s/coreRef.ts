import { all, type Input } from '@pulumi/pulumi';
import { CrossStack } from '../CrossStack.ts';
import { k8sConfig } from './client.ts';
import { cfg } from '../cfg.ts';
export { cfg };

const core = new CrossStack(cfg.require('k8s-core'));
export const $core = core.k8sCoreOutput();

// Resolved sync at module-load time so it can be used in `if (...)` gates
// directly. Source of truth lives in k8s-core's config; k8s-essentials
// follows.
export const envoyGatewayEnabled = ((await core.getValue<boolean>('envoyGatewayEnabled')) ?? false);
export const externalDnsZoneDomains = ((await core.getValue<string[]>('externalDnsZoneDomains')) ?? []);
// Per-cluster Tailscale proxy tags, sourced from k8s-core. Empty until k8s-core
// publishes the output; consumers fall back to the unqualified defaults.
export const tailscaleProxyDefaultTags = ((await core.getValue<string[]>('tailscaleProxyDefaultTags')) ?? []);

export const clusterName = $core.name;
export const clusterFullName = core.name.split('/')[2];
export const tags = $core.tags;
export const version = $core.version;
export const backups = {
  bucket: $core.backupsBucket,
  sa: $core.backupsServiceAccountArn,
};
export const oidcProvider = $core.oidcProviderArn;
export const region = core.region();

const upperCore = $core.coreStack.apply((name) => new CrossStack(`bes/core/${name}`));
export const $network = upperCore.apply((core) => core.network());
export const accountId = upperCore.apply((core) => core.accountId());

// Guard that AWS credentials point at the cluster's account (the core stack
// publishes `accountId`). Reuses the core reference above rather than importing
// common/coreRef.ts, which would create a *second* StackReference to the same
// core stack and clash. The current account is passed in (from awsAccount) so
// this module stays usable by credential-less workload stacks.
export function failIfIncorrectAccount(currentAccountId: Input<string>): void {
  all([upperCore.apply((core) => core.get<string>('accountId')), currentAccountId]).apply(
    ([expected, actual]) => {
      if (expected !== actual) {
        throw new Error(`Incorrect AWS account: expected ${expected} but got ${actual}`);
      }
    },
  );
}

export async function failIfIncorrectCluster(kubeconfig?: string): Promise<void> {
  const kubeServer = (() => {
    try {
      const kc = k8sConfig(kubeconfig);
      return kc.getCurrentCluster()?.server;
    } catch (err) {
      console.error('This usually means your kubeconfig is broken');
      throw err;
    }
  })();

  if (!kubeServer) {
    throw new Error('No current cluster');
  }

  const tailscaleEndpoint = /^https:\/\/k8s-operator-([a-z0-9-]+)\.tail[0-9a-f]{5}\.ts\.net$/.exec(
    kubeServer,
  );
  if (tailscaleEndpoint) {
    if (tailscaleEndpoint[1] !== clusterFullName) {
      throw new Error(
        `Incorrect cluster: expected ${clusterFullName} but got ${tailscaleEndpoint[1]}`,
      );
    }

    //console.debug('Using tailscale proxy', kubeServer);
    return;
  }

  const coreServer = (await core.k8sCore()).endpoint;
  if (kubeServer !== coreServer) {
    throw new Error(`Incorrect cluster: expected ${coreServer} but got ${kubeServer}`);
  }
}
