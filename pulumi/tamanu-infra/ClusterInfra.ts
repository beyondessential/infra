import { ComponentResource, ComponentResourceOptions, Output, all } from '@pulumi/pulumi';
import { Cluster } from '@pulumi/aws/ecs';
import { SecurityGroup } from '@pulumi/aws/ec2';
import { Instance as DBInstance, SubnetGroup } from '@pulumi/aws/rds';
import { Network, NetworkOutputs } from './Network';
import { RustLambda } from './RustLambda';

export interface ClusterInfraArgs {
  network: Network | NetworkOutputs;
  tags?: { [key: string]: string };
}

export interface ClusterInfraOutputs {
  database: Output<string>;
  provisioner: Output<string>;
  containers: {
    securityGroup: Output<string>;
    ecs: Output<string>;
  };
}

export class ClusterInfra extends ComponentResource {
  #name: string;
  #network: NetworkOutputs;
  #args: Omit<Required<ClusterInfraArgs>, 'network'>;

  #cluster: Cluster;
  #database: DBInstance;
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

    // Subnet group for database
    const dbSubnetGroup = new SubnetGroup(
      name,
      {
        subnetIds: this.#network.workloadSubnetIds,
        tags: {
          Name: `${name}-database`,
          Purpose: 'database',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    this.#cluster = new Cluster(
      name,
      {
        tags: this.#args.tags,
      },
      { parent: this },
    );

    // Single common database for all Tamanu clusters
    // Obviously this would be bad for production but for internal use it's good:
    // cheaper in aggregate, and tons faster to boot a new cluster.
    this.#database = new DBInstance(
      this.#name,
      {
        allocatedStorage: 20,
        autoMinorVersionUpgrade: true,
        dbSubnetGroupName: dbSubnetGroup.name,
        engine: 'postgres',
        engineVersion: '14.6',
        instanceClass: 'db.t4g.medium', // ARM64
        manageMasterUserPassword: true,
        networkType: 'IPV4', // FIXME: DUAL
        performanceInsightsEnabled: false, // DISABLE WHEN DEVING: adds two minutes to the boot/create time
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

    this.registerOutputs(
      (this.outputs = {
        database: this.#database.arn,
        provisioner: this.dbProvisioner().name.apply((name) => name!),
        containers: {
          securityGroup: this.#securityGroups.containers.id,
          ecs: this.#cluster.arn,
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
          openPort('SSH', 22), // FIXME: testing
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

    return { databases, containers, provisioner };
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
}
