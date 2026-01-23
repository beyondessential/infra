import { CrossStack } from '../CrossStack.ts';
import { k8sConfig } from './client.ts';
import { cfg } from '../cfg.ts';
export { cfg };

const core = new CrossStack(cfg.require('k8s-core'));
export const $core = core.k8sCoreOutput();

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

export async function failIfIncorrectCluster(kubeconfig?: string): Promise<void> {
  const kc = k8sConfig(kubeconfig);
  const kubeServer = kc.getCurrentCluster()?.server;

  if (!kubeServer) {
    throw new Error('No current cluster');
  }

  const tailscaleEndpoint = /^https:\/\/k8s-([a-z0-9-]+)\.tail[0-9a-f]{5}\.ts\.net$/.exec(
    kubeServer,
  );
  if (tailscaleEndpoint) {
    if (tailscaleEndpoint[1] !== clusterFullName) {
      throw new Error(
        `Incorrect cluster: expected ${clusterFullName} but got ${tailscaleEndpoint[1]}`,
      );
    }

    console.debug('Using tailscale proxy', kubeServer);
    return;
  }

  const coreServer = (await core.k8sCore()).endpoint;
  if (kubeServer !== coreServer) {
    throw new Error(`Incorrect cluster: expected ${coreServer} but got ${kubeServer}`);
  }
}
