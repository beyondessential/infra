import type { ResourceOptions, Input } from '@pulumi/pulumi';
import { TailnetKey } from '@pulumi/tailscale';

export interface TailscaleKeyArgs {
  tags: Input<Input<string>[]>;
  expirySecs: Input<number>;
  ephemeral?: Input<boolean>;
  description?: Input<string>;
}

export function tailscaleKey(
  name: string,
  { tags, expirySecs, ephemeral = false, description = name }: TailscaleKeyArgs,
  opts: ResourceOptions = {},
) {
  return new TailnetKey(
    name,
    {
      description,
      expiry: expirySecs,
      ephemeral,

      reusable: false, // single-use
      preauthorized: true, // no need to approve manually

      // apply those on the device on creation
      // this also sets non-expiry
      tags,
    },
    opts,
  );
}
