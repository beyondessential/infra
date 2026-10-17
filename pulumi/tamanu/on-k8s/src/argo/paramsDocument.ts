import type { Input } from '@pulumi/pulumi';
import type { Channel } from '../../../../common/tamanuRenderer.ts';

// The parameter document handed to infra-argo-tamanu-renderer (its params.rs), built from plain
// values so it can be checked without a cluster or a Pulumi run. params.ts gathers the values.

// Keys the stub acts on itself, or that only the program the renderer replaces
// reads. They are not the renderer's business. Anything else is passed on, and
// the renderer rejects what it does not know.
export const STUB_ONLY = new Set([
  'imageTag',
  'appVersion',
  'deployment',
  'k8s-core',
  'externalNamespace',
  'argoNamespace',
  'argoProject',
  'argoWaitMinutes',
  'rendererRepo',
  'rendererPath',
  // Which channel renders the deployment. The renderer rejects it as unknown.
  'rendererChannel',
]);

/**
 * The stack's config as strings, minus what the stub keeps for itself. `all` is every config
 * value Pulumi holds, keyed `project:name`; `secrets` is the set of those keys that are secret.
 */
// spec: K8STRO#parameters
export function selectStackConfig(
  all: Readonly<Record<string, string>>,
  project: string,
  secrets: ReadonlySet<string>,
): Record<string, string> {
  const prefix = `${project}:`;
  const config: Record<string, string> = {};
  for (const [full, value] of Object.entries(all)) {
    if (!full.startsWith(prefix)) continue;
    const key = full.slice(prefix.length);
    if (STUB_ONLY.has(key)) continue;
    if (secrets.has(full)) {
      // The Application, and so the value, is readable in the cluster.
      throw new Error(`${key} is a secret, which cannot be passed to the renderer`);
    }
    config[key] = value;
  }
  return config;
}

export interface RenderParams {
  stack: string;
  imageTag: string;
  appVersion: string;
  config: Record<string, string>;
  cluster: {
    fullName: string;
    dnsZoneDomains: Input<string[]>;
    tailscaleProxyDefaultTags: Input<string[]>;
    networkV4Cidr: Input<string | undefined>;
    networkV6Cidr: Input<string | undefined>;
    backupsBucket: Input<string | undefined>;
    backupsServiceAccountArn: Input<string | undefined>;
  };
  billing: { stage: Input<string | undefined>; deployment: Input<string | undefined> };
  seed?: { snapshot: Input<string> };
}

/** The renderer's parameter document in the shape the newest renderer accepts. */
export function buildParams(inputs: RenderParams): RenderParams {
  return {
    stack: inputs.stack,
    imageTag: inputs.imageTag,
    appVersion: inputs.appVersion,
    config: inputs.config,
    cluster: inputs.cluster,
    billing: inputs.billing,
    seed: inputs.seed,
  };
}

/**
 * Converts parameters from the newest shape to the one `stable`'s renderer accepts. The two are
 * the same until a change to what the stub passes reaches `canary` first; its conversion goes
 * here, and is deleted once `stable` has been promoted past it.
 */
function toStable(params: RenderParams): RenderParams {
  return params;
}

/** The parameters in the shape the channel's renderer accepts. */
// spec: K8STRO#parameters
export function forChannel(channel: Channel, params: RenderParams): RenderParams {
  return channel === 'stable' ? toStable(params) : params;
}
