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

import { AMI_UBUNTU_ARM64, TAILNET_DOMAIN } from '../constants/internal.ts';
import { region } from './awsAccount.ts';
import {
  cloudInitYaml,
  hostnameCommands,
  tailscaleInstallCommands,
  tailscaleUpCommands,
  emergencySshKeyCommands,
} from './cloudInit.ts';
import { ec2StatusAlarms } from './ec2StatusAlarms.ts';

export interface TailscaleBoxArgs {
  tailscaleTags: Input<Input<string>[]>;
  instanceArgs: InstanceArgs;
  tailscaleName?: Input<string>;
  tags?: { [key: string]: string };
  alertTopicArns?: Input<string>[];
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
      alertTopicArns: [],
      ...args,
    };

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
        ami: AMI_UBUNTU_ARM64[region],
        metadataOptions: {
          httpTokens: 'required',
          httpProtocolIpv6: 'enabled',
          instanceMetadataTags: 'enabled',
        },
        userData: all([authKey.key, output(this.#args.tailscaleName)]).apply(([key, name]) =>
          secret(
            cloudInitYaml([
              ...hostnameCommands(name),
              ...tailscaleInstallCommands(),
              ...tailscaleUpCommands({ authKey: key, hostname: name }),
              ...emergencySshKeyCommands(),
            ]),
          ),
        ),
        tags: {
          ...(this.#args.instanceArgs.tags ?? {}),
          ...this.#args.tags,
        },
      },
      {
        parent: authKey,
        // don't redeploy when our AMI updates
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

    if (args.alertTopicArns && args.alertTopicArns.length > 0) {
      ec2StatusAlarms(
        this.#name,
        {
          instanceId: this.box.id,
          notifyTopicArns: args.alertTopicArns,
          tags: this.#args.tags,
        },
        { parent: this.box },
      );
    }
  }
}
