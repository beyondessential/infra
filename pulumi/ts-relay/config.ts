import { Config, getStack } from '@pulumi/pulumi';

const cfg = new Config();

export const core = cfg.require('core');
export const relayPort = cfg.getNumber('relayPort') ?? 40000;
export const relayName = cfg.get('relayName') ?? getStack();
export const instanceType = cfg.get('instanceType') ?? 't4g.micro';
export const nodeName = `[Tailscale Peer Relay] ${relayName}`;

export const tailscaleTags = ['tag:infra', 'tag:infra-ts-relay', `tag:infra-ts-relay-${relayName}`];
