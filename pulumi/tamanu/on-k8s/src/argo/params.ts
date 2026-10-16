import { type Input, type Output, getStack, jsonStringify, runtime } from '@pulumi/pulumi';
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
import { appVersion } from '../version.ts';
import { channel } from './channel.ts';
import { buildParams, forChannel, selectStackConfig } from './paramsDocument.ts';

// The input contract with infra-argo-tamanu-renderer (its params.rs) lives in paramsDocument.ts.
// The stub passes the stack's config through as Pulumi holds it, every value a string, and the
// renderer parses and validates it, so a new option only changes the renderer. What the stub
// adds is what only it can resolve: the image tag, the version, and the cluster's facts. What it
// sends is in the shape the deployment's channel accepts.

/** The renderer's parameter document, as the JSON an Argo plugin receives. */
export function renderParams(seed?: { snapshot: Input<string> }): Output<string> {
  const secrets = new Set<string>(JSON.parse(process.env.PULUMI_CONFIG_SECRET_KEYS ?? '[]'));
  const params = buildParams({
    stack: getStack(),
    imageTag,
    appVersion,
    config: selectStackConfig(runtime.allConfig(), cfg.name, secrets),
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
    seed,
  });
  return jsonStringify(forChannel(channel, params));
}
