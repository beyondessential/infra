import { Config } from '@pulumi/pulumi';
import { billingTags } from '../../common/billing.ts';

const cfg = new Config('tinker');

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/tinker-gateway:${imageTag}`;

export const gatewayReplicas = cfg.getNumber('replicas') ?? 2;
export const gatewayTailscaleName = cfg.get('tailscaleName') ?? 'tinker-gateway';

export const deployment = cfg.get('deployment') ?? 'tinker';
export const stage = cfg.get('stage') ?? 'test';
export const costLabels = billingTags({
  product: 'tamanu',
  stage,
  deployment,
});
