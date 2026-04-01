import { Config } from '@pulumi/pulumi';

const cfg = new Config('tinker');

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/tinker-gateway:${imageTag}`;

export const gatewayReplicas = cfg.getNumber('replicas') ?? 2;
export const gatewayTailscaleName = cfg.get('tailscaleName') ?? 'tinker-gateway';
