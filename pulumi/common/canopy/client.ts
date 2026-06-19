// Thin client for Canopy's private admin API, reached over the tailnet. Auth is
// implicit: the tailscale ingress proxy injects the caller's identity
// (Tailscale-User-Login) — same trust model as pulumi->k8s, so no auth header
// and no stored credentials. See docs/plans/canopy-k8s-registration-provider.md.
//
// SKELETON — TODO(TAM-6877): the endpoint paths and request/response field
// shapes below are provisional. Confirm them against canopy's generated
// /api/openapi.json before the resource is wired into any stack. Until then no
// stack instantiates CanopyBackupConfig, so none of this runs.

export interface BackupConfigInput {
  serverGroupId: string;
  bucket: string;
  prefix: string;
  region: string;
  targetRoleArn: string; // device role (server_group_backup_config.target_role_arn)
  maintenanceRoleArn: string;
  mode: string; // machine flow: 'from_birth' (canopy generates the passphrase)
}

const ENDPOINTS = {
  upsert: '/api/backup_configs/upsert',
  get: '/api/backup_configs/get',
  delete: '/api/backup_configs/delete',
};

async function request(baseUrl: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) return undefined;
  const text = await res.text();
  if (!res.ok) throw new Error(`canopy ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

function toWire(cfg: BackupConfigInput): Record<string, string> {
  return {
    server_group_id: cfg.serverGroupId,
    bucket: cfg.bucket,
    prefix: cfg.prefix,
    region: cfg.region,
    target_role_arn: cfg.targetRoleArn,
    maintenance_role_arn: cfg.maintenanceRoleArn,
    mode: cfg.mode,
  };
}

// Idempotent upsert; canopy runs its server-side access-check (the probe) before
// persisting, so a misconfigured role/bucket fails fast.
export async function upsertBackupConfig(baseUrl: string, cfg: BackupConfigInput): Promise<void> {
  await request(baseUrl, ENDPOINTS.upsert, toWire(cfg));
}

export async function getBackupConfig(
  baseUrl: string,
  serverGroupId: string,
): Promise<BackupConfigInput | undefined> {
  const res = (await request(baseUrl, ENDPOINTS.get, { server_group_id: serverGroupId })) as
    | Record<string, string>
    | undefined;
  if (!res) return undefined;
  return {
    serverGroupId: res.server_group_id,
    bucket: res.bucket,
    prefix: res.prefix ?? '',
    region: res.region,
    targetRoleArn: res.target_role_arn,
    maintenanceRoleArn: res.maintenance_role_arn,
    mode: res.mode,
  };
}

// Delete removes the config and the canopy-owned passphrase Secret.
export async function deleteBackupConfig(baseUrl: string, serverGroupId: string): Promise<void> {
  await request(baseUrl, ENDPOINTS.delete, { server_group_id: serverGroupId });
}
