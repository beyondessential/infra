import { Config, getStack } from '@pulumi/pulumi';
import * as oci from '@pulumi/oci';

const cfg = new Config();
const compartmentId = cfg.require('compartmentId');
const v4 = cfg.getBoolean('networkV4') ?? true;
const v6 = cfg.getBoolean('networkV6') ?? true;
export const tags: { [key: string]: string } = cfg.getObject('tags') ?? {};

export const network = new oci.core.Vcn('core', {
  compartmentId: compartmentId,
  dnsLabel: getStack().replace(/[^a-z0-9]+/ig, ''),
  displayName: 'core-network',
  cidrBlocks: v4 ? ['10.128.0.0/16'] : [],
  isIpv6enabled: v6,
  freeformTags: tags,
});
