import { cfg } from '../../../common/k8s/coreRef.ts';
import { TAILNET_DOMAIN } from '../../../constants/internal.ts';

export const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/canopy:${imageTag}`;
export const maxConcurrentRestores = cfg.getNumber('maxConcurrentRestores') ?? 2;

// Tailscale sidecar authkey (carries tag:pgro-operator). The sidecar is pgro's
// only path to Canopy, and its tailnet node is pgro's identity there.
export const tailscaleAuthkey = cfg.requireSecret('tailscaleAuthKey');

export const canopyTailnetUrl = `https://canopy.${TAILNET_DOMAIN}`;

// ghcr credentials for pulling a private reporting-schema builder image
// (`tamanu-dbt-*`). Unset where every builder image is public.
export const builderPullUser = cfg.get('builderPullUser');
export const builderPullPat = cfg.getSecret('builderPullPat');
