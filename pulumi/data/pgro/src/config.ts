import { cfg } from '../../../common/k8s/coreRef.ts';

export const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/postgres-restore-operator:${imageTag}`;
export const maxConcurrentRestores = cfg.getNumber('maxConcurrentRestores') ?? 2;

// Tailscale sidecar authkey (carries tag:pgro-operator). When set, the
// operator pod joins the tailnet and the canopy path can be activated.
export const tailscaleAuthkey = cfg.getSecret('tailscaleAuthkey');

// Public canopy hostname. Presence opts the operator into the canopy path;
// unset keeps it in legacy-only mode (existing PostgresPhysicalReplica CRDs).
// The client still auto-prefers the tailnet; this URL is the mTLS fallback.
export const canopyBaseUrl = cfg.get('canopyBaseUrl');

// Optional mTLS fallback identity: the operator's own device private key
// (P-256 EC, PEM) — nothing else. bestool-canopy self-signs a short-lived
// cert from it per request; its public key IS the canopy device, which a
// canopy admin promotes to backup-restore. Only used if the tailnet probe
// fails.
export const canopyDeviceKey = cfg.getSecret('canopyDeviceKey');

// Override for canopy-provisioned pgdata PVCs (operator default is 20Gi).
export const canopyPgdataPvcSize = cfg.get('canopyPgdataPvcSize');
