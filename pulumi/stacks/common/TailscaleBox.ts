import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  all,
  output,
  secret,
} from '@pulumi/pulumi';
import { DeviceKey, TailnetKey, getDeviceOutput } from '@pulumi/tailscale';
import { Instance, InstanceArgs } from '@pulumi/aws/ec2/index.js';

import { alpineAmi } from '../constants/external.ts';
import { TAILNET_DOMAIN } from '../constants/internal.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TailscaleBoxArgs {
  tailscaleTags: Input<Input<string>[]>;
  instanceArgs: InstanceArgs;
  tailscaleName?: Input<string>;
  tags?: { [key: string]: string };
}

// If you need to recreate the box without destroying the rest of the stack,
// you'll need to manually terminate the EC2 instance, remove the device from
// Tailscale, and delete the TailnetKey (and dependents) from the Pulumi state.
//
// Changes to the init script will _not_ cause the box to be replaced, and will
// _not_ cause the script to be re-run. If you need to, either manually delete
// as explained above, or make the changes yourself via SSH.

export class TailscaleBox extends ComponentResource {
  #name: string;
  #args: Required<TailscaleBoxArgs>;

  box: Instance;
  key: DeviceKey;

  constructor(name: string, args: TailscaleBoxArgs, opts: ComponentResourceOptions = {}) {
    super('bes:common:TailscaleBox', name, {}, opts);
    this.#name = name;
    this.#args = {
      tailscaleName: this.#name,
      tags: {},
      ...args,
    };

    const alpine = alpineAmi();

    const authKey = new TailnetKey(
      this.#name,
      {
        ephemeral: false,

        // 5 minutes is fine when starting from where the VPC is up, but
        // if we're starting from scratch, we want more like 10 to 15.
        expiry: 15 * 60,

        reusable: false, // single-use
        preauthorized: true, // no need to approve manually

        // apply those on the device on creation
        tags: this.#args.tailscaleTags,
      },
      { parent: this },
    );

    this.box = new Instance(
      this.#name,
      {
        keyName: 'ops',
        ...this.#args.instanceArgs,
        ami: alpine.id,
        userData: all([authKey.key, output(this.#args.tailscaleName)]).apply(([key, name]) =>
          secret(
            readFileSync(join(__dirname, 'tailscalebox-init.sh'), 'utf-8')
              .replace(/%TAILSCALE_AUTH_KEY%/g, key)
              .replace(/%TAILSCALE_NAME%/g, name),
          ),
        ),
        tags: {
          ...(this.#args.instanceArgs.tags ?? {}),
          ...this.#args.tags,
        },
      },
      {
        parent: authKey,
        // don't redeploy when Alpine's AMI updates
        ignoreChanges: ['ami'],
      },
    );

    const tailscaleDevice = getDeviceOutput({
      // bind to the box, even if we don't use any of the outputs
      name: this.box.arn.apply((_) => `${this.#args.tailscaleName}.${TAILNET_DOMAIN}`),
      waitFor: '15m',
    });

    // Disable device key expiry so we don't have to attend to the box.
    // this is different from the TailnetKey expiry, which must be kept short
    this.key = new DeviceKey(
      this.#name,
      {
        deviceId: tailscaleDevice.id,
        keyExpiryDisabled: true,
      },
      { parent: authKey },
    );
  }
}
