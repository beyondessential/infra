import { Input, Output, Unwrap, all, log, output, runtime } from '@pulumi/pulumi';
import * as k8s from '@kubernetes/client-node';
import { k8sConfig } from './client.js';

export interface K8sWaitForOptions {
  kubeconfig?: Input<string>;
  limitRetries?: number;

  /** @default 1 */
  waitIntervalSeconds?: number;
}

export function k8sWaitFor<A>(
  description: string,
  waiter: (kc: k8s.KubeConfig, arg: Unwrap<A>) => Promise<void>,
  waiterArg: Input<A>,
  options: K8sWaitForOptions = {},
): Output<void> {
  if (runtime.isDryRun()) {
    return output(undefined as void);
  }

  return all([options.kubeconfig, waiterArg]).apply(async ([kubeconfig, arg]) => {
    const kc = k8sConfig(kubeconfig);
    log.info(`Waiting for ${description}...`);

    let tries = 0;
    while (true) {
      tries += 1;
      if (options.limitRetries && tries > options.limitRetries) {
        throw new Error(`Exceeded retry limit (${options.limitRetries}) for ${description}`);
      }

      try {
        return await waiter(kc, arg);
      } catch (err) {
        await new Promise((res) => setTimeout(res, (options.waitIntervalSeconds ?? 1) * 1000));
      }
    }
  });
}
