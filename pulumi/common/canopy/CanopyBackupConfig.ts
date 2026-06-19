import {
  Config,
  dynamic,
  type CustomResourceOptions,
  type Input,
  type Output,
} from '@pulumi/pulumi';
import {
  type BackupConfigInput,
  upsertBackupConfig,
  getBackupConfig,
  deleteBackupConfig,
} from './client.ts';

// Registers a server-group's backup config with Canopy as a managed resource, so
// pulumi (which creates the bucket + roles) stops hand-copying ARNs into the UI.
// Calls the private admin API over the tailnet; identity is injected by the
// tailscale ingress (TailscaleAdmin), so there are no credentials here.
//
// SKELETON: the API shapes live in ./client.ts and are provisional pending
// canopy's OpenAPI (TAM-6877). No stack instantiates this yet — wiring is: read
// a `serverGroupId` stack config (which also gates provisioning) and pass it plus
// the existing deviceRoleArn / maintenanceRoleArn / bucket / region exports.

export interface CanopyBackupConfigArgs {
  /** server_group_id; the idempotency anchor (replace-on-change). */
  serverGroupId: Input<string>;
  bucket: Input<string>;
  /** Empty/root for our single-group-per-bucket usage. */
  prefix?: Input<string>;
  region: Input<string>;
  /** Device role ARN (`deviceRoleArn`). */
  targetRoleArn: Input<string>;
  maintenanceRoleArn: Input<string>;
  /** Machine flow; defaults to `from_birth`. */
  mode?: Input<string>;
  /** Override the canopy private API base URL (default `canopy:apiUrl` config). */
  apiUrl?: Input<string>;
}

interface Props extends BackupConfigInput {
  apiUrl: string;
}

const MANAGED_KEYS = [
  'bucket',
  'prefix',
  'region',
  'targetRoleArn',
  'maintenanceRoleArn',
  'mode',
  'apiUrl',
] as const;

const provider: dynamic.ResourceProvider<Props, Props> = {
  async check(_olds, news) {
    const failures: dynamic.CheckFailure[] = [];
    for (const k of [
      'serverGroupId',
      'bucket',
      'region',
      'targetRoleArn',
      'maintenanceRoleArn',
    ] as const) {
      if (!news[k]) failures.push({ property: k, reason: `${k} is required` });
    }
    return { inputs: news, failures: failures.length ? failures : undefined };
  },

  // Pure comparison, no network — preview / unchanged `up` never contacts Canopy.
  async diff(_id, olds, news) {
    const replaces = olds.serverGroupId !== news.serverGroupId ? ['serverGroupId'] : [];
    const changes = MANAGED_KEYS.filter((k) => olds[k] !== news[k]);
    return {
      replaces: replaces.length ? replaces : undefined,
      changes: changes.length + replaces.length > 0,
    };
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

  async read(id, olds) {
    const fetched = await getBackupConfig(olds.apiUrl, id);
    if (!fetched) return { id: '' }; // gone canopy-side → pulumi recreates
    return { id, props: { ...olds, ...fetched } };
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
        region: args.region,
        targetRoleArn: args.targetRoleArn,
        maintenanceRoleArn: args.maintenanceRoleArn,
        mode: args.mode ?? 'from_birth',
        apiUrl,
      },
      opts,
      'canopy',
      'BackupConfig',
    );
  }
}
