import { Config } from '@pulumi/pulumi';

const cfg = new Config();

export const core = cfg.require('core');
export const instanceType = cfg.get('instanceType') ?? 't4g.micro';
export const sshPublicKey = cfg.get('sshPublicKey');

// tag:infra-ts-relay-source is unscoped on every OAuth client (nothing has
// ever used it — infra/relay.mjs), so minting a key with it directly fails
// the apply outright, not just silently. Deploy with tags this client (the
// tamanu-on-linux environment) is actually scoped for — same ones iti-derp
// used — then retag to tag:infra-ts-relay-source by hand in the admin
// console once it's registered.
export const tailscaleTags = ['tag:server', 'tag:server-tamanu'];

export const nodeName = 'Tailscale Peer Relay: verify client';
