// The channels the Tamanu renderer is published and rendered through, shared by the stack that
// registers the plugins (tamanu/k8s-infra) and the one that names a plugin in each
// deployment's Application (tamanu/on-k8s). docs/spec/tamanu/renderer-rollout.md says what a
// channel is; this is the part both stacks must agree on.

export const CHANNELS = ['stable', 'canary'] as const;
export type Channel = (typeof CHANNELS)[number];

/** The plugin config's `spec.version`. Argo CD registers a plugin as `<name>-<version>`. */
export const PLUGIN_VERSION = 'v1';

/** The renderer image every channel's sidecar runs, at the channel's tag. */
export const RENDERER_IMAGE = 'ghcr.io/beyondessential/infra-argo-tamanu-renderer';

/**
 * Which channel a deployment's stack config asks for. CD writes an unset option as the string
 * "null", which means the same as no value at all.
 */
// r[impl channel.default]
// r[impl channel.unknown]
export function parseChannel(value: string | null | undefined): Channel {
  if (value == null || value === '' || value === 'null') return 'stable';
  if ((CHANNELS as readonly string[]).includes(value)) return value as Channel;
  throw new Error(
    `rendererChannel ${JSON.stringify(value)} is not a renderer channel; use ${CHANNELS.join(' or ')}`,
  );
}

/**
 * The plugin's own name, which is also its sidecar's container name. Stable keeps the name that
 * Applications created before channels existed refer to.
 */
// r[impl channel.stable-continuity]
// r[impl plugin.per-channel]
export function pluginBaseName(channel: Channel): string {
  return channel === 'stable'
    ? 'infra-argo-tamanu-renderer'
    : `infra-argo-tamanu-renderer-${channel}`;
}

/** The name an Application's `source.plugin.name` gives to select the channel's plugin. */
export function pluginName(channel: Channel): string {
  return `${pluginBaseName(channel)}-${PLUGIN_VERSION}`;
}

/** The image the channel's sidecar runs. The tag is the channel's name and moves on promotion. */
// r[impl channel.tags]
export function rendererImage(channel: Channel): string {
  return `${RENDERER_IMAGE}:${channel}`;
}
