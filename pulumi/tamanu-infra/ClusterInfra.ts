import { ComponentResource, ComponentResourceOptions, Output, all, secret } from '@pulumi/pulumi';
import { Cluster } from '@pulumi/aws/ecs';
import { Instance, SecurityGroup, getAmiOutput } from '@pulumi/aws/ec2';
import { Instance as DBInstance, SubnetGroup } from '@pulumi/aws/rds';
import { Network, NetworkOutputs } from './Network';
import { RustLambda } from './RustLambda';
import { LoadBalancer } from '@pulumi/aws/lb';
import { PrivateDnsNamespace } from '@pulumi/aws/servicediscovery';
import { readFileSync } from 'fs';
import { DeviceKey, DeviceTags, TailnetKey } from '@pulumi/tailscale';
import { getDeviceOutput } from '@pulumi/tailscale/getDevice';

export interface ClusterInfraArgs {
  network: Network | NetworkOutputs;
  tags?: { [key: string]: string };
}

export interface ClusterInfraOutputs {
  endpoints: {
    lb: Output<string>;
  };
  database: Output<string>;
  provisioner: Output<string>;
  containers: {
    securityGroup: Output<string>;
    ecs: Output<string>;
    discovery: Output<string>;
  };
}

export class ClusterInfra extends ComponentResource {
  #name: string;
  #network: NetworkOutputs;
  #args: Omit<Required<ClusterInfraArgs>, 'network'>;

  #cluster: Cluster;
  #cloudmap: PrivateDnsNamespace;
  #database: DBInstance;
  #lb: LoadBalancer;
  #securityGroups: { [key: string]: SecurityGroup };

  outputs: ClusterInfraOutputs;

  constructor(
    name: string,
    { network, ...args }: ClusterInfraArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('pkg:index:ClusterInfra', name, {}, opts);
    this.#name = name;
    this.#network = network instanceof Network ? network.outputs : network;
    this.#args = {
      tags: {},
      ...args,
    };
    this.#args.tags.Cluster = name;

    // Security groups
    this.#securityGroups = this.securityGroups();

    // ECS cluster
    this.#cluster = new Cluster(
      this.#name,
      {
        tags: this.#args.tags,
      },
      { parent: this },
    );

    this.#cloudmap = new PrivateDnsNamespace(
      this.#name,
      {
        name: `${this.#name}.tamanu.bes.au`,
        vpc: this.#network.vpc,
        tags: this.#args.tags,
      },
      { parent: this.#cluster },
    );

    // Application LB across zones for API and Web public access to containers.
    this.#lb = new LoadBalancer(
      // Workaround for LB names being forbidden from starting with internal-
      `${this.#name.startsWith('internal') ? `tamanu-${this.#name}` : this.#name}-http`,
      {
        internal: false,
        loadBalancerType: 'application',
        subnets: this.#network.natSubnetIds,
        ipAddressType: 'ipv4',
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
        database: this.#database.arn,
        provisioner: this.dbProvisioner().name.apply((name) => name!),
        containers: {
          securityGroup: this.#securityGroups.containers.id,
          ecs: this.#cluster.arn,
          discovery: this.#cloudmap.id,
        },
        endpoints: {
          lb: this.#lb.dnsName,
        },
      }),
    );
  }

  securityGroups() {
    const all = {
      fromPort: 0,
      toPort: 0,
      protocol: '-1',
      cidrBlocks: ['0.0.0.0/0'],
    };
    const allICMPv4 = {
      fromPort: -1,
      toPort: -1,
      cidrBlocks: ['0.0.0.0/0'],
      description: 'ICMPv4',
      protocol: '1',
    };
    const openPort = (description: string, port: number, protocol: string = 'tcp') => ({
      description,
      fromPort: port,
      toPort: port,
      protocol,
      cidrBlocks: ['0.0.0.0/0'],
    });
    const openVpcPort = (description: string, port: number, protocol: string = 'tcp') => ({
      ...openPort(description, port, protocol),
      description: `${description} from VPC`,
      cidrBlocks: [this.#network.v4Cidr],
    });

    const databases = new SecurityGroup(
      `${this.#name}-databases`,
      {
        vpcId: this.#network.vpc,
        ingress: [openVpcPort('Postgres', 5432)],
        egress: [all],
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
          allICMPv4,
          openPort('HTTP', 80),
          openPort('HTTPS', 443),
          openPort('HTTP/3', 443, 'udp'),
        ],
        egress: [all],
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

    const provisioner = new SecurityGroup(
      `${this.#name}-provisioner`,
      {
        vpcId: this.#network.vpc,
        ingress: [],
        egress: [all],
        tags: {
          Name: `${this.#name}-provisioner`,
          Purpose: 'provisioner',
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
        ingress: [],
        egress: [all],
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

    return { databases, containers, provisioner, jumpbox };
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
        engineVersion: '14.6',
        instanceClass: 'db.t4g.medium', // ARM64
        manageMasterUserPassword: true,
        networkType: 'IPV4', // FIXME: DUAL
        performanceInsightsEnabled: true, // DISABLE WHEN DEVING: adds two minutes to the boot/create time
        publiclyAccessible: false,
        skipFinalSnapshot: true, // FIXME: configure final snapshot
        storageType: 'gp3',
        username: 'postgres',
        vpcSecurityGroupIds: [this.#securityGroups.databases.id],
      },
      {
        parent: this,
      },
    );

    return rds;
  }

  dbProvisioner() {
    return new RustLambda(
      `${this.#name}-provisioner`,
      {
        zip: '../../glue/provisioner/target/lambda/provisioner.zip',
        description: 'Provision databases and users for an RDS instance',
        timeoutSec: 300,
        environment: all([this.#database.endpoint, this.#database.masterUserSecrets]).apply(
          ([endpoint, secrets]) => ({
            PGHOST: endpoint.split(':')[0],
            PGPORT: endpoint.split(':')[1] ?? '5432',
            DB_SECRET: secrets[0].secretArn,
          }),
        ),
        network: {
          subnetIds: this.#network.workloadSubnetIds,
          securityGroupIds: [this.#securityGroups.provisioner.id],
        },
        policies: [
          {
            // policy to allow reading the db-managed "master" secret(s)
            name: 'getdbmastersecret',
            policy: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['secretsmanager:GetSecretValue'],
                  Resource: this.#database.masterUserSecrets.apply((secrets) =>
                    secrets.map((secret) => secret.secretArn),
                  ),
                },
              ],
            },
          },
          {
            // policy to allow reading provisioned db secrets for this cluster
            name: 'getdbsecrets',
            policy: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['secretsmanager:GetSecretValue'],
                  Resource: `arn:aws:secretsmanager:ap-southeast-2:*:secret:${this.#name}-db-*`,
                },
              ],
            },
          },
        ],
        tags: { Purpose: 'provisioner', ...this.#args.tags },
      },
      { parent: this },
    );
  }

  jumpBox() {
    const alpine = getAmiOutput({
      mostRecent: true,
      filters: [
        {
          name: 'name',
          values: ['alpine-3.*-aarch64-uefi-tiny-r0'],
          // tiny = https://gitlab.alpinelinux.org/alpine/cloud/tiny-cloud
        },
        {
          name: 'virtualization-type',
          values: ['hvm'],
        },
      ],
      owners: ['538276064493'], // official Alpine images
    });

    const name = `${this.#name}-jumpbox`;

    const authKey = new TailnetKey(
      name,
      {
        ephemeral: false,
        expiry: 300,
        preauthorized: true,
        reusable: false, // single-use
      },
      { parent: this },
    );

    const box = new Instance(
      name,
      {
        ami: alpine.id,
        instanceType: 't4g.nano',
        rootBlockDevice: {
          volumeSize: 1,
        },
        subnetId: this.#network.workloadSubnetIds[0],
        vpcSecurityGroupIds: [this.#securityGroups.jumpbox.id],
        userData: all([this.#database.endpoint, authKey.key]).apply(([endpoint, key]) =>
          secret(
            readFileSync('jumpbox-init.sh', 'utf-8')
              .replace('%DB_ENDPOINT%', endpoint)
              .replace('%TAILSCALE_AUTH_KEY%', key)
              .replace('%TAILSCALE_NAME%', name),
          ),
        ),
        userDataReplaceOnChange: true,
        tags: {
          Name: name,
          Purpose: 'jumpbox',
          ...this.#args.tags,
        },
      },
      { parent: authKey },
    );

    const tailscaleDevice = getDeviceOutput({
      name,
      waitFor: '3m',
    });

    // Disable key expiry
    new DeviceKey(
      name,
      {
        deviceId: tailscaleDevice.id,
        keyExpiryDisabled: true,
      },
      { parent: authKey },
    );

    // Configure Tailscale tags
    new DeviceTags(
      name,
      {
        deviceId: tailscaleDevice.id,
        tags: ['tag:infra', 'tag:infra-dbproxy'],
      },
      { parent: authKey },
    );

    return box;
  }
}
