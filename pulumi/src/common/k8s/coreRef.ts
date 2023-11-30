import { Config } from '@pulumi/pulumi';
import { CrossStack } from '../CrossStack.js';
import { k8sConfig } from './client.js';

export const cfg = new Config();

const core = new CrossStack(cfg.require('k8s-core'));
export const $core = core.k8sCoreOutput();

export const clusterName = $core.name;
export const tags = $core.tags;
export const version = $core.version;

export async function failIfIncorrectCluster(kubeconfig?: string): Promise<void> {
  const kc = k8sConfig(kubeconfig);
  const kubeServer = kc.getCurrentCluster()?.server;
  const coreServer = (await core.k8sCore()).endpoint;
  if (kubeServer !== coreServer) {
    throw new Error(`Incorrect cluster: expected ${coreServer} but got ${kubeServer}`);
  }
}
