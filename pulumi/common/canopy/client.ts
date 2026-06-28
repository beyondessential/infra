// Thin client for Canopy's private admin API (backups config-as-a-resource),
// reached over the tailnet. Auth is implicit: the tailscale ingress proxy injects
// the caller's identity, and upsert/delete require a tailscale-admin (group:ops)
// caller — same trust model as pulumi->k8s, so no auth header / stored creds.
// Routes: POST /api/backups/{upsert,get,delete} (canopy fns/backups.rs).

export interface BackupConfigInputs {
  serverGroupId: string;
  bucket: string;
  prefix: string;
  region?: string;
  targetRoleArn: string;
  maintenanceRoleArn: string;
}
// Schedule/retention are not part of this API — they're UI-owned (managed via
// Canopy's separate schedule endpoints). upsert covers bucket/roles/region only.

// The subset of BackupConfigView we reflect for drift detection.
export interface BackupConfigState {
  bucket: string;
  prefix: string;
  region: string;
  targetRoleArn: string;
  maintenanceRoleArn: string;
}

const ENDPOINTS = {
  upsert: '/api/backups/upsert',
  get: '/api/backups/get',
  delete: '/api/backups/delete',
};

async function request(baseUrl: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) return undefined; // group/config absent
  const text = await res.text();
  if (!res.ok) throw new Error(`canopy ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

// Idempotent from-birth upsert; Canopy runs its server-side probe before
// persisting, so a non-empty/inaccessible bucket or bad role fails fast.
// bucket/prefix are immutable — changing them returns 409.
export async function upsertBackupConfig(baseUrl: string, cfg: BackupConfigInputs): Promise<void> {
  const body: Record<string, unknown> = {
    server_group_id: cfg.serverGroupId,
    bucket: cfg.bucket,
    prefix: cfg.prefix,
    target_role_arn: cfg.targetRoleArn,
    maintenance_role_arn: cfg.maintenanceRoleArn,
  };
  if (cfg.region !== undefined) body.region = cfg.region;
  await request(baseUrl, ENDPOINTS.upsert, body);
}

// get returns Option<BackupConfigView>: 200 null = no config, 404 = group gone.
// Either way → undefined (pulumi recreates).
export async function getBackupConfig(
  baseUrl: string,
  serverGroupId: string,
): Promise<BackupConfigState | undefined> {
  const view = (await request(baseUrl, ENDPOINTS.get, { server_group_id: serverGroupId })) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!view) return undefined;
  return {
    bucket: view.bucket as string,
    prefix: view.prefix as string,
    region: (view.region as string) ?? '',
    targetRoleArn: view.target_role_arn as string,
    maintenanceRoleArn: view.maintenance_role_arn as string,
  };
}

// Removes the config row + the Canopy-owned passphrase Secret (the bucket and its
// object-locked objects persist). 404 (already gone) is tolerated by request().
export async function deleteBackupConfig(baseUrl: string, serverGroupId: string): Promise<void> {
  await request(baseUrl, ENDPOINTS.delete, { server_group_id: serverGroupId });
}
