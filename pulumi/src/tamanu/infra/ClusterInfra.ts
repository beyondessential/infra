import { readFileSync } from 'fs';

import { ComponentResource, ComponentResourceOptions, Output, all, secret } from '@pulumi/pulumi';
import { DeviceKey, TailnetKey, getDeviceOutput } from '@pulumi/tailscale';

import { Instance, SecurityGroup } from '@pulumi/aws/ec2/index.js';
import { Instance as DBInstance, SubnetGroup } from '@pulumi/aws/rds/index.js';
import { PrivateDnsNamespace } from '@pulumi/aws/servicediscovery/index.js';
import { getZone } from '@pulumi/aws/route53/index.js';

import { LoadBalancer } from '../../common/LoadBalancer.js';
import * as securityGroupRules from '../../common/securityGroupRules.js';
import { alpineAmi } from '../../constants/external.js';
import { TAILNET_DOMAIN } from '../../constants/internal.js';
import { CrossStackNetwork } from '../../common/CrossStack.js';

export interface ClusterInfraArgs {
  network: CrossStackNetwork;

  /** ID or Name of the public hosted zone for this cluster. */
  zone: string;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface LbOutputs {
  arn: Output<string>;
  dnsName: Output<string>;
  dnsCName: Output<string>;
  listener: Output<string>;
}

export interface ClusterInfraOutputs {
  database: {
    instance: Output<string>;
    endpoint: Output<string>;
  };
  containers: {
    securityGroup: Output<string>;
    namespaceId: Output<string>;
    namespaceName: Output<string>;
    loadbalancer: Output<string>;
  };
  lb: LbOutputs;
  zone: {
    id: Output<string>;
    name: Output<string>;
  };
}

export class ClusterInfra extends ComponentResource {
  #name: string;
  #network: CrossStackNetwork;
  #args: Omit<Required<ClusterInfraArgs>, 'network'>;

  #cloudmap: PrivateDnsNamespace;
  #database: DBInstance;
  #zone: Output<{ id: string; name: string }>;
  #securityGroups: { [key: string]: SecurityGroup };

  outputs: ClusterInfraOutputs;

  constructor(
    name: string,
    { network, ...args }: ClusterInfraArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:ClusterInfra', name, {}, opts);
    this.#name = name;
    this.#network = network;
    this.#args = {
      tags: {},
      ...args,
    };
    this.#args.tags.Infra = name;

    // Security groups
    this.#securityGroups = this.securityGroups();

    this.#cloudmap = new PrivateDnsNamespace(
      this.#name,
      {
        name: `${this.#name}.tamanu.bes`,
        vpc: this.#network.vpc,
        tags: this.#args.tags,
      },
      { parent: this },
    );

    this.#zone = all([
      getZone({
        zoneId: this.#args.zone,
      }).catch((idErr: Error) =>
        getZone({
          name: this.#args.zone,
        }).catch((nameErr: Error) => {
          throw new Error(`Could not find zone by ID or name:\n${idErr}\n${nameErr}`);
        }),
      ),
    ]).apply(([zone]) => ({
      id: zone.zoneId,
      name: zone.name,
    }));

    // Application LB across zones for API and Web public access to containers.
    const { lb, listener } = new LoadBalancer(
      // Workaround for LB names being forbidden from starting with internal-
      `${this.#name.startsWith('internal') ? `tamanu-${this.#name}` : this.#name}-http`,
      {
        subnetIds: this.#network.natSubnetIds,
        securityGroupIds: [this.#securityGroups.lb.id],
        defaultDnsName: this.#zone.name,
        zoneId: this.#zone.id,
        tags: {
          Purpose: 'containers',
          ...this.#args.tags,
        },
      },
      { parent: this },
    );

    // Single common database for all Tamanu clusters
    // Obviously this would be bad for production but for internal use it's good:
    // cheaper in aggregate, and tons faster to boot a new cluster.
    this.#database = this.database();

    // Tailscale-only jumpbox for within-VPC access for ops,
    // and for external access to the database for devs/testers.
    this.jumpBox();

    this.registerOutputs(
      (this.outputs = {
        database: {
          instance: this.#database.arn,
          endpoint: this.#database.endpoint,
        },
        containers: {
          securityGroup: this.#securityGroups.containers.id,
          namespaceId: this.#cloudmap.id,
          namespaceName: this.#cloudmap.name,
          loadbalancer: lb.arn,
        },
        lb: {
          arn: lb.arn,
          dnsName: lb.dnsName,
          dnsCName: this.#zone.name,
          listener: listener.arn,
        },
        zone: this.#zone,
      }),
    );
  }

  securityGroups() {
    const { openVpcPort } = securityGroupRules.withNetwork(this.#network);

    const databases = new SecurityGroup(
      `${this.#name}-databases`,
      {
        vpcId: this.#network.vpc,
        ingress: [...securityGroupRules.allICMP, openVpcPort('Postgres', 5432)],
        egress: [securityGroupRules.all],
        tags: {
          Name: `${this.#name}-databases`,
          Purpose: 'database',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const containers = new SecurityGroup(
      `${this.#name}-containers`,
      {
        vpcId: this.#network.vpc,
        ingress: [
          ...securityGroupRules.allICMP,
          openVpcPort('SSH', 22),
          openVpcPort('HTTP', 80),
          openVpcPort('Internal HTTP', 3000),
          openVpcPort('HTTPS', 443),
          openVpcPort('HTTP/3', 443, 'udp'),
        ],
        egress: [securityGroupRules.all],
        tags: {
          Name: `${this.#name}-containers`,
          Purpose: 'containers',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const jumpbox = new SecurityGroup(
      `${this.#name}-jumpbox`,
      {
        vpcId: this.#network.vpc,
        ingress: [...securityGroupRules.allICMP],
        egress: [securityGroupRules.all],
        tags: {
          Name: `${this.#name}-jumpbox`,
          Purpose: 'jumpbox',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const lb = new SecurityGroup(
      `${this.#name}-lb`,
      {
        vpcId: this.#network.vpc,
        ingress: [
          ...securityGroupRules.allICMP,
          securityGroupRules.openPort('HTTP', 80),
          securityGroupRules.openPort('HTTPS', 443),
        ],
        egress: [securityGroupRules.all],
        tags: {
          Name: `${this.#name}-lb`,
          Purpose: 'lb',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    return { databases, containers, jumpbox, lb };
  }

  database() {
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
        engineVersion: '14.7',
        instanceClass: 'db.t4g.medium', // ARM64
        manageMasterUserPassword: true,
        networkType: 'DUAL',
        performanceInsightsEnabled: true,
        publiclyAccessible: false,
        skipFinalSnapshot: true, // FIXME: configure final snapshot
        storageType: 'gp3',
        username: 'postgres',
        vpcSecurityGroupIds: [this.#securityGroups.databases.id],
        backupRetentionPeriod: 7,
        // caCertIdentifier: 'rds-ca-ecc384-g1', // TODO: test that tamanu is fine with this
      },
      {
        parent: this,
        ignoreChanges: ['engineVersion'], // minor auto-updates are fine
      },
    );

    return rds;
  }

  jumpBox() {
    const alpine = alpineAmi();

    const name = `${this.#name}-jumpbox`;
    const tailscaleName = `tamanu-${this.#name}-jumpbox`;

    const authKey = new TailnetKey(
      name,
      {
        ephemeral: false,

        // 5 minutes is fine when starting from where the VPC is up, but
        // if we're starting from scratch, we want more like 10 to 15.
        expiry: 15 * 60,

        reusable: false, // single-use
        preauthorized: true, // no need to approve manually

        // apply those on the device on creation
        tags: ['tag:infra', 'tag:infra-dbproxy'],
      },
      { parent: this },
    );

    // If you need to recreate the jumpbox without destroying the rest of the stack,
    // you'll need to manually terminate the jumpbox EC2 instance, remove the device
    // from Tailscale, and delete the TailnetKey (and dependents) from the Pulumi state.

    const box = new Instance(
      name,
      {
        keyName: 'ops',
        ami: alpine.id,
        instanceType: 't4g.nano',
        rootBlockDevice: {
          volumeSize: 1,
        },
        subnetId: this.#network.workloadSubnetIds[0],
        vpcSecurityGroupIds: [this.#securityGroups.jumpbox.id],

        // Changes to the script or to the db endpoint will _not_ cause the box to be replaced,
        // and will _not_ cause the script to be re-run. If you need to, either manually delete
        // as explained above, or make the changes yourself via SSH.
        userData: all([this.#database.endpoint, authKey.key]).apply(([endpoint, key]) =>
          secret(
            readFileSync('jumpbox-init.sh', 'utf-8')
              .replace(/%DB_ENDPOINT%/g, endpoint)
              .replace(/%TAILSCALE_AUTH_KEY%/g, key)
              .replace(/%TAILSCALE_NAME%/g, tailscaleName),
          ),
        ),
        tags: {
          Name: '[Internal] Tailscale Jumpbox',
          Purpose: 'jumpbox',
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
      // the suffix here is the MagicDNS domain for our tailnet
      name: box.arn.apply((_) => `${tailscaleName}.${TAILNET_DOMAIN}`),
      waitFor: '15m',
    });

    // Disable device key expiry so we don't have to attend to the box.
    // this is different from the TailnetKey expiry, which must be kept short
    new DeviceKey(
      name,
      {
        deviceId: tailscaleDevice.id,
        keyExpiryDisabled: true,
      },
      { parent: authKey },
    );

    return box;
  }
}
