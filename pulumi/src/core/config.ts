import { Config } from '@pulumi/pulumi';

const cfg = new Config();
export const v6 = cfg.getBoolean('networkV6') ?? true;
export const forEksCluster = cfg.getBoolean('forEksCluster') ?? false;
export const privateSubnets = (cfg.getBoolean('privateSubnets') ?? false) || forEksCluster;
export const publicSubnets = cfg.getBoolean('publicSubnets') ?? true;
export const withEndpoints = cfg.getBoolean('withEndpoints') || forEksCluster;
export const withGithubOidc = (cfg.getBoolean('withGithubOidc') ?? true) || forEksCluster;
export const tags: { [key: string]: string } = cfg.getObject('tags') ?? {};

let v4: string | boolean | undefined = cfg.get('networkV4');
try {
  v4 = cfg.getBoolean('networkV4');
} catch (_) {}
export { v4 };
