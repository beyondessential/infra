import { ComponentResource, ComponentResourceOptions, Output } from '@pulumi/pulumi';
import { SecurityGroup } from '@pulumi/aws/ec2/index.js';
import { Instance as DBInstance, SubnetGroup } from '@pulumi/aws/rds/index.js';

import { Network, NetworkOutputs } from '../common/Network.js';
import * as securityGroupRules from '../common/securityGroupRules.js';
import { TailscaleBox } from '../common/TailscaleBox.js';

export interface NetboxArgs {
  network: Network | NetworkOutputs;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface NetboxOutputs {
  box: Output<string>;
  database: Output<string>;
  tailscale: Output<string>;
}

export class Netbox extends ComponentResource {
  #name: string;
  #network: NetworkOutputs;
  #args: Omit<Required<NetboxArgs>, 'network'>;

  outputs: NetboxOutputs;

  constructor(name: string, { network, ...args }: NetboxArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tools:Netbox', name, {}, opts);
    this.#name = name.includes('netbox') ? name : `${name}-netbox`;
    this.#network = network instanceof Network ? network.outputs : network;
    this.#args = {
      tags: {},
      ...args,
    };
    this.#args.tags.Application = 'netbox';

    const database = this.database();

    const secGroup = new SecurityGroup(
      this.#name,
      {
        vpcId: this.#network.vpc,
        ingress: [securityGroupRules.allICMPv4],
        egress: [securityGroupRules.all],
        tags: {
          Name: '[Tools] Netbox',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const { box, key } = new TailscaleBox(
      this.#name,
      {
        tailscaleTags: ['tag:tools'],
        instanceArgs: {
          instanceType: 't4g.small',
          rootBlockDevice: {
            volumeSize: 20,
          },
          subnetId: this.#network.workloadSubnetIds[0],
          vpcSecurityGroupIds: [secGroup.id],
          tags: {
            Name: '[Tools] Netbox',
          },
        },
        tags: this.#args.tags,
      },
      { parent: this },
    );

    this.registerOutputs(
      (this.outputs = {
        box: box.arn,
        database: database.arn,
        tailscale: key.deviceId,
      }),
    );
  }

  database() {
    const { openVpcPort } = securityGroupRules.withNetwork(this.#network);

    const secGroup = new SecurityGroup(
      `${this.#name}-database`,
      {
        vpcId: this.#network.vpc,
        ingress: [securityGroupRules.allICMPv4, openVpcPort('Postgres', 5432)],
        egress: [securityGroupRules.all],
        tags: {
          Name: `${this.#name}-database`,
          Purpose: 'database',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const subnetGroup = new SubnetGroup(
      this.#name,
      {
        subnetIds: this.#network.workloadSubnetIds,
        tags: {
          Name: `${this.#name}-database`,
          Purpose: 'database',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const rds = new DBInstance(
      this.#name,
      {
        allocatedStorage: 20,
        maxAllocatedStorage: 100,
        autoMinorVersionUpgrade: true,
        dbSubnetGroupName: subnetGroup.name,
        engine: 'postgres',
        engineVersion: '15.3',
        instanceClass: 'db.t4g.small', // ARM64
        manageMasterUserPassword: true,
        networkType: 'IPV4',
        performanceInsightsEnabled: true,
        publiclyAccessible: false,
        storageType: 'gp3',
        username: 'postgres',
        vpcSecurityGroupIds: [secGroup.id],
      },
      {
        parent: this,
        ignoreChanges: ['engineVersion'], // minor auto-updates are fine
      },
    );

    return rds;
  }
}
