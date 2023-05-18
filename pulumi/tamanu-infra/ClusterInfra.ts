import { Netmask } from 'netmask';
import {
  ComponentResource,
  ComponentResourceOptions,
  getStack,
  Output,
  output,
  jsonStringify,
  all,
} from '@pulumi/pulumi';
import { Cluster } from '@pulumi/aws/ecs';
import { PrivateDnsNamespace } from '@pulumi/aws/servicediscovery';
import { Vpc, EgressOnlyInternetGateway, Subnet, SecurityGroup } from '@pulumi/aws/ec2';
import { SubnetGroup } from '@pulumi/aws/rds';
import { Function } from '@pulumi/aws-native/lambda';
import { Role } from '@pulumi/aws-native/iam';

export interface ClusterInfraArgs {
  ipv4Cidr: string;
  ipv4SubnetBlock?: number;
  ipv6SubnetBlock?: number;
}

export interface ClusterInfraSubnets {
  /** Database subnets */
  db: Subnet[];
  /** Runtime (application containers) subnets */
  rt: Subnet[];
}

export interface ClusterInfraSubnetOutputs {
  db: string[];
  rt: string[];
}

export interface ClusterInfraOutputs {
  vpc: Output<string>;
  eigw: Output<string>;
  subnets: Output<ClusterInfraSubnetOutputs>;
  dbSecGroup: Output<string>;
  rtSecGroup: Output<string>;
  dbSubnetGroup: Output<string>;
  dbProvisioner: Output<string>;
  ecsCluster: Output<string>;
  cloudmapNamespace: Output<string>;
}

export class ClusterInfra extends ComponentResource {
  #name: string;
  #args: Required<ClusterInfraArgs>;

  #vpc: Vpc;
  #subnets: ClusterInfraSubnets;

  outputs: ClusterInfraOutputs;

  constructor(name: string, args: ClusterInfraArgs, opts: ComponentResourceOptions = {}) {
    super('pkg:index:ClusterInfra', name, {}, opts);
    this.#name = name;
    this.#args = {
      ipv4SubnetBlock: 20,
      ipv6SubnetBlock: 64,
      ...args,
    };

    this.#vpc = new Vpc(
      `${name}-vpc`,
      {
        enableDnsSupport: true,
        cidrBlock: args.ipv4Cidr,
        assignGeneratedIpv6CidrBlock: true,
        tags: {
          Name: `${name}-vpc-${getStack()}`,
        },
      },
      { parent: this },
    );
    const eigw = new EgressOnlyInternetGateway(
      `${name}-eigw`,
      {
        vpcId: this.#vpc.id,
      },
      { parent: this },
    );

    // up to 16 /20 subnets
    this.#subnets = {
      db: [this.addSubnet('a', 0), this.addSubnet('b', 1)],
      rt: [this.addSubnet('b', 2), this.addSubnet('c', 3)],
    };

    // Security groups
    const { dbSecGroup, rtSecGroup } = this.securityGroups();

    // Subnet config for databases
    const dbSubnetGroup = new SubnetGroup(
      `${name}-dbsubnetgroup`,
      {
        subnetIds: this.#subnets.db.map((subnet) => subnet.id),
      },
      {
        parent: this,
      },
    );

    const namespace = new PrivateDnsNamespace(
      `${name}-cloudmap`,
      {
        vpc: this.#vpc.id,
      },
      { parent: this },
    );

    const ecsCluster = new Cluster(
      `${name}-cluster`,
      {
        serviceConnectDefaults: {
          namespace: namespace.arn,
        },
      },
      { parent: this },
    );

    const dbProvisioner = this.dbProvisioner(rtSecGroup);

    this.registerOutputs(
      (this.outputs = {
        vpc: this.#vpc.id,
        eigw: eigw.id,
        subnets: output({
          db: this.#subnets.db.map((subnet) => subnet.id),
          rt: this.#subnets.rt.map((subnet) => subnet.id),
        }),
        dbSecGroup: dbSecGroup.id,
        rtSecGroup: rtSecGroup.id,
        dbSubnetGroup: dbSubnetGroup.name,
        dbProvisioner: all([dbProvisioner.functionName, dbProvisioner.arn]).apply(
          ([name, arn]) => name ?? arn,
        ),
        ecsCluster: ecsCluster.arn,
        cloudmapNamespace: namespace.arn,
      }),
    );
  }

  addSubnet(az: string, index: number) {
    let ipv4BlockCalc = new Netmask(
      new Netmask(this.#args.ipv4Cidr).base,
      this.#args.ipv4SubnetBlock.toString(),
    );
    for (let i = 0; i < index; i += 1) {
      ipv4BlockCalc = ipv4BlockCalc.next();
    }
    const ipv4Block = ipv4BlockCalc.toString();

    const ipv6Block = this.#vpc.ipv6CidrBlock.apply((cidr) =>
      cidr.replace('00::/56', `${index.toString(16).padStart(2, '0')}::/64`),
    );

    return new Subnet(
      `${this.#name}-subnet-${index}`,
      {
        vpcId: this.#vpc.id,
        cidrBlock: ipv4Block,
        availabilityZone: `ap-southeast-2${az}`,
        ipv6CidrBlock: ipv6Block,
      },
      {
        parent: this,
      },
    );
  }

  securityGroups() {
    const allEgress = {
      fromPort: 0,
      toPort: 0,
      protocol: '-1',
      cidrBlocks: ['0.0.0.0/0'],
      ipv6CidrBlocks: ['::/0'],
    };
    const ingressVpcPort = (description: string, port: number, protocol: string = 'tcp') => ({
      description: `${description} from VPC`,
      fromPort: 0,
      toPort: port,
      protocol,
      cidrBlocks: [this.#vpc.cidrBlock],
      ipv6CidrBlocks: [this.#vpc.ipv6CidrBlock],
    });

    const dbSecGroup = new SecurityGroup(
      `${this.#name}-dbsecgroup`,
      {
        vpcId: this.#vpc.id,
        ingress: [ingressVpcPort('Postgres', 5432)],
        egress: [allEgress],
      },
      {
        parent: this,
      },
    );

    const rtSecGroup = new SecurityGroup(
      `${this.#name}-rtsecgroup`,
      {
        vpcId: this.#vpc.id,
        ingress: [
          ingressVpcPort('HTTP', 80),
          ingressVpcPort('HTTPS', 443),
          ingressVpcPort('HTTP/3', 443, 'udp'),
        ],
        egress: [allEgress],
      },
      {
        parent: this,
      },
    );

    return { dbSecGroup, rtSecGroup };
  }

  dbProvisioner(rtSecGroup: SecurityGroup) {
    const dbProvisionerRole = new Role(
      `${this.#name}-db-provisioner`,
      {
        assumeRolePolicyDocument: {
          version: '2012-10-17',
          statement: [
            {
              effect: 'Allow',
              principal: { service: 'lambda.amazonaws.com' },
              action: 'sts:AssumeRole',
            },
          ],
        },
        policies: [
          {
            policyName: 'secretsmanager-getdbsecret',
            policyDocument: jsonStringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['secretsmanager:GetSecretValue'],
                },
              ],
            }),
          },
        ],
      },
      { parent: this },
    );

    return new Function(
      `${this.#name}-db-provisioner`,
      {
        code: {
          zipFile: '../../lambdas/provisioner/target/lambda/provisioner.zip',
        },
        runtime: 'provided.al2',
        architectures: ['arm64'],
        role: dbProvisionerRole.arn,
        description: 'Provision databases and users for an RDS instance',
        vpcConfig: {
          subnetIds: this.#subnets.rt.map((subnet) => subnet.id),
          securityGroupIds: [rtSecGroup.id],
        },
      },
      { parent: this },
    );
  }
}
