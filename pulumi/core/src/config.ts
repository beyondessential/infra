import { Config, getStack } from '@pulumi/pulumi';

const cfg = new Config();
export const v6 = cfg.getBoolean('networkV6') ?? true;
export const forEksCluster = cfg.getBoolean('forEksCluster') ?? false;
export const privateSubnets = (cfg.getBoolean('privateSubnets') ?? false) || forEksCluster;
export const publicSubnets = cfg.getBoolean('publicSubnets') ?? true;
export const withGithubOidc = (cfg.getBoolean('withGithubOidc') ?? true) || forEksCluster;
export const enableDnsHostnames = cfg.getBoolean('enableDnsHostnames') ?? true;
export const tags: { [key: string]: string } = cfg.getObject('tags') ?? {};

let v4Config: string | boolean | undefined = cfg.get('networkV4');
try {
  v4Config = cfg.getBoolean('networkV4');
} catch (_) {}
if (v4Config === undefined) {
  v4Config = true;
}
const v4: string | boolean = v4Config;
export { v4 };

let stackName = getStack();
let domain = cfg.get('domain');
if (!domain) {
  if (stackName.startsWith('tamanu-')) {
    let prefix = stackName.replace(/^tamanu-/, '');
    if (stackName.endsWith('-prod')) {
      prefix = prefix.replace(/-prod$/, '');
    }
    domain = `${prefix}.tamanu.app`;
  } else {
    domain = cfg.require('domain');
  }
} else if (domain === 'false') {
  domain = undefined;
}

export { domain };

export const zoneImport = cfg.get('zoneImport');
export const trailBucket = cfg.get('trailBucket') ?? `bes-${stackName}-cloudtrail`;
