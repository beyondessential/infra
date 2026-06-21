import {
  Config,
  dynamic,
  type CustomResourceOptions,
  type Input,
  type Output,
} from '@pulumi/pulumi';
import {
  type BackupConfigInputs,
  upsertBackupConfig,
  getBackupConfig,
  deleteBackupConfig,
} from './client.ts';

// Registers a server-group's backup config with Canopy as a managed resource so
// pulumi (which creates the bucket + roles) stops hand-copying ARNs into the UI.
// Calls the private admin API over the tailnet; identity is injected by the
// tailscale ingress (the caller must be a tailscale-admin / group:ops), so there
// are no credentials here. Upsert is from-birth onto an empty bucket only.

export interface CanopyBackupConfigArgs {
  /** server_group_id; the identity/idempotency anchor (replace-on-change). */
  serverGroupId: Input<string>;
  /** Immutable on re-apply (replace-on-change, matching the API's 409). */
  bucket: Input<string>;
  /** Immutable; empty/root for our single-group-per-bucket usage. */
  prefix?: Input<string>;
  region?: Input<string>;
  /** Device role ARN (`deviceRoleArn`). */
  targetRoleArn: Input<string>;
  maintenanceRoleArn: Input<string>;
  /** Override the canopy private API base URL (default `canopy:apiUrl`). */
  apiUrl?: Input<string>;
}

interface Props extends Omit<BackupConfigInputs, 'region'> {
  region: string;
  apiUrl: string;
}

// Replace-on-change (the API treats these as immutable identity).
const REPLACE_KEYS = ['serverGroupId', 'bucket', 'prefix'] as const;
// Reconciled in place on update.
const UPDATE_KEYS = ['region', 'targetRoleArn', 'maintenanceRoleArn', 'apiUrl'] as const;

const provider: dynamic.ResourceProvider<Props, Props> = {
  async check(_olds, news) {
    const failures: dynamic.CheckFailure[] = [];
    for (const k of ['serverGroupId', 'bucket', 'targetRoleArn', 'maintenanceRoleArn'] as const) {
      if (!news[k]) failures.push({ property: k, reason: `${k} is required` });
    }
    return { inputs: news, failures: failures.length ? failures : undefined };
  },

  // Pure comparison, no network — preview / unchanged `up` never contacts Canopy.
  async diff(_id, olds, news) {
    const replaces = REPLACE_KEYS.filter((k) => olds[k] !== news[k]);
    const changed =
      replaces.length > 0 ||
      UPDATE_KEYS.some((k) => JSON.stringify(olds[k]) !== JSON.stringify(news[k]));
    return { replaces: replaces.length ? [...replaces] : undefined, changes: changed };
  },

  async create(inputs) {
    await upsertBackupConfig(inputs.apiUrl, inputs);
    return { id: inputs.serverGroupId, outs: inputs };
  },

  async update(_id, _olds, news) {
    await upsertBackupConfig(news.apiUrl, news);
    return { outs: news };
  },

  async delete(id, olds) {
    await deleteBackupConfig(olds.apiUrl, id);
  },

  // Also the import path (`pulumi import` / { import: serverGroupId }); olds may
  // be empty then, so fall back to the default API URL.
  async read(id, olds) {
    const apiUrl = (olds && olds.apiUrl) || DEFAULT_API_URL;
    const state = await getBackupConfig(apiUrl, id);
    if (!state) return { id: '' }; // gone canopy-side → pulumi recreates
    // Reflect drift on the server-owned core fields.
    return { id, props: { ...olds, ...state, apiUrl } };
  },
};

const DEFAULT_API_URL = 'https://canopy.tail53aef.ts.net';

export class CanopyBackupConfig extends dynamic.Resource {
  declare readonly serverGroupId: Output<string>;
  declare readonly bucket: Output<string>;
  declare readonly region: Output<string>;
  declare readonly targetRoleArn: Output<string>;
  declare readonly maintenanceRoleArn: Output<string>;

  constructor(name: string, args: CanopyBackupConfigArgs, opts?: CustomResourceOptions) {
    const apiUrl = args.apiUrl ?? new Config('canopy').get('apiUrl') ?? DEFAULT_API_URL;
    super(
      provider,
      name,
      {
        serverGroupId: args.serverGroupId,
        bucket: args.bucket,
        prefix: args.prefix ?? '',
        region: args.region ?? '',
        targetRoleArn: args.targetRoleArn,
        maintenanceRoleArn: args.maintenanceRoleArn,
        apiUrl,
      },
      opts,
      'canopy',
      'BackupConfig',
    );
  }
}

export interface RegisterBackupConfigArgs extends Omit<CanopyBackupConfigArgs, 'serverGroupId'> {
  /** When absent, no config is registered (the stack isn't onboarded yet). */
  serverGroupId?: Input<string>;
}

// Convenience for bucket-owner stacks: instantiate only when serverGroupId is set
// (its presence is the provisioning gate).
export function registerBackupConfig(
  name: string,
  args: RegisterBackupConfigArgs,
  opts?: CustomResourceOptions,
): CanopyBackupConfig | undefined {
  if (!args.serverGroupId) return undefined;
  return new CanopyBackupConfig(name, { ...args, serverGroupId: args.serverGroupId }, opts);
}
