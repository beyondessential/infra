import { type Output, getStack, jsonStringify, runtime } from '@pulumi/pulumi';
import { cfg } from '../../../../common/cfg.ts';
import {
  $network,
  backups,
  clusterFullName,
  externalDnsZoneDomains,
  tailscaleProxyDefaultTags,
} from '../../../../common/k8s/coreRef.ts';
import { deployment, stage } from '../config.ts';
import { imageTag } from '../image.ts';

// The input contract with infra-argo-tamanu-renderer (its params.rs). The stub
// passes the stack's config through as Pulumi holds it, every value a string,
// and the renderer parses and validates it, so a new option only changes the
// renderer. What the stub adds is what only it can resolve: the image tag, the
// version, and the cluster's facts.

// Keys the stub acts on itself, or that only the program the renderer replaces
// reads. They are not the renderer's business. Anything else is passed on, and
// the renderer rejects what it does not know.
const STUB_ONLY = new Set([
  'imageTag',
  'appVersion',
  'deployment',
  'k8s-core',
  'externalNamespace',
  'deployer',
  'argoNamespace',
  'argoProject',
  'argoWaitMinutes',
  'rendererRepo',
  'rendererPath',
]);

// CD writes an unset option as the string "null".
function raw(key: string): string | undefined {
  const value = cfg.get(key);
  return value == null || value === 'null' ? undefined : value;
}

function stackConfig(): Record<string, string> {
  const project = `${cfg.name}:`;
  const secrets = new Set<string>(JSON.parse(process.env.PULUMI_CONFIG_SECRET_KEYS ?? '[]'));
  const config: Record<string, string> = {};
  for (const [full, value] of Object.entries(runtime.allConfig())) {
    if (!full.startsWith(project)) continue;
    const key = full.slice(project.length);
    if (STUB_ONLY.has(key)) continue;
    if (secrets.has(full)) {
      // The Application, and so the value, is readable in the cluster.
      throw new Error(`${key} is a secret, which cannot be passed to the renderer`);
    }
    config[key] = value;
  }
  return config;
}

/** The renderer's parameter document, as the JSON an Argo plugin receives. */
export function renderParams(): Output<string> {
  return jsonStringify({
    stack: getStack(),
    imageTag,
    appVersion: raw('appVersion'),
    config: stackConfig(),
    cluster: {
      fullName: clusterFullName,
      dnsZoneDomains: externalDnsZoneDomains,
      tailscaleProxyDefaultTags,
      networkV4Cidr: $network.apply((n) => n.v4Cidr),
      networkV6Cidr: $network.apply((n) => n.v6Cidr),
      backupsBucket: backups.bucket,
      backupsServiceAccountArn: backups.sa,
    },
    billing: { stage, deployment },
  });
}
