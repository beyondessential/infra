import { Config } from '@pulumi/pulumi';

const cfg = new Config();

export const core = cfg.require('core');
export const instanceType = cfg.get('instanceType') ?? 't4g.small';
export const regionId = cfg.getNumber('regionId') ?? 900;

// Only these sources get a STUN reply, so only they measure a latency to the
// region and can pick it as home. Everyone else can still connect over 443.
export const stunAllowCidrs = cfg.requireObject<string[]>('stunAllowCidrs');

// TLS SNI only: the DERP map forces IPv4/IPv6, so clients never resolve it.
export const derpHostname = cfg.get('derpHostname') ?? 'iti-derp.bes.au';

export const tailscaleVersion = 'v1.102.5';
export const goTarball = 'go1.27.1.linux-arm64.tar.gz';
export const goSha256 = '3450b45a3f9ee8568792736a5c5e70a1f2e9b36c35a8f74958c03e51d7d92bec';

export const nodeName = 'Tailscale DERP: iti';
export const tailscaleName = 'iti-derp';
// Mintable by the tamanu-on-linux OAuth client; retag to tag:infra-derp once up.
export const tailscaleTags = ['tag:server', 'tag:server-tamanu'];
