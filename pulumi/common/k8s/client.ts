import * as k8s from '@kubernetes/client-node';

export function k8sConfig(kubeconfig?: string): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();

  if (kubeconfig) {
    kc.loadFromString(kubeconfig);
  } else {
    kc.loadFromDefault();
  }

  return kc;
}

export function k8sClient<T extends k8s.ApiType>(
  apiClientType: new (config: k8s.Configuration) => T,
  kubeconfig?: string,
): T {
  return k8sConfig(kubeconfig).makeApiClient(apiClientType);
}
