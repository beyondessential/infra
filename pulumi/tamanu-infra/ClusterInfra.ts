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
import {
  Vpc,
  EgressOnlyInternetGateway,
  Subnet,
  SecurityGroup,
  InternetGateway,
  Route,
} from '@pulumi/aws/ec2';
import { SubnetGroup } from '@pulumi/aws/rds';
// this form is required to import lambda as otherwise it creates a circular dependency error
import * as aws from '@pulumi/aws';
import { Role } from '@pulumi/aws-native/iam';
import { FileArchive } from '@pulumi/pulumi/asset';

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

    // free, but only IPv6
    const v6gw = new EgressOnlyInternetGateway(
      `${name}-eigw`,
      {
        vpcId: this.#vpc.id,
      },
      { parent: this },
    );

    // paid, but required due to AWS APIs in our region not supporting IPv6
    const v4gw = new InternetGateway(
      `${name}-igw`,
      {
        vpcId: this.#vpc.id,
      },
      { parent: this },
    );

    new Route('outbound-v4', {
      routeTableId: this.#vpc.mainRouteTableId,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId: v4gw.id,
    }, { parent: this });

    new Route('outbound-v6', {
      routeTableId: this.#vpc.mainRouteTableId,
      destinationIpv6CidrBlock: '::/0',
      egressOnlyGatewayId: v6gw.id,
    }, { parent: this });

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
        subnets: output({
          db: this.#subnets.db.map((subnet) => subnet.id),
          rt: this.#subnets.rt.map((subnet) => subnet.id),
        }),
        dbSecGroup: dbSecGroup.id,
        rtSecGroup: rtSecGroup.id,
        dbSubnetGroup: dbSubnetGroup.name,
        dbProvisioner: all([dbProvisioner.name, dbProvisioner.arn]).apply(
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
        assignIpv6AddressOnCreation: true,
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
      fromPort: port,
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
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        policies: [
          {
            // basic policy required for lambda
            policyName: 'lambda-basic',
            policyDocument: jsonStringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: [
                    'logs:CreateLogGroup',
                    'logs:CreateLogStream',
                    'logs:PutLogEvents',
                    'ec2:CreateNetworkInterface',
                    'ec2:DescribeNetworkInterfaces',
                    'ec2:DeleteNetworkInterface',
                  ],
                  Resource: '*',
                },
              ],
            }),
          },
          {
            // policy to allow reading db secrets for this cluster
            policyName: 'secretsmanager-getdbsecrets',
            policyDocument: jsonStringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['secretsmanager:GetSecretValue'],
                  Resource: `arn:aws:secretsmanager:ap-southeast-2:*:secret:${this.#name}-db-*`,
                },
              ],
            }),
          },
        ],
      },
      { parent: this },
    );

    const code = new FileArchive('../../glue/provisioner/target/lambda/provisioner.zip');
    return new aws.lambda.Function(
      `${this.#name}-db-provisioner`,
      {
        code,
        runtime: 'provided.al2',
        handler: 'bootstrap',
        architectures: ['arm64'],
        role: dbProvisionerRole.arn,
        description: 'Provision databases and users for an RDS instance',
        timeout: 300,
        environment: {
          variables: {
            RUST_LOG: 'trace',
          },
        },
        vpcConfig: {
          subnetIds: this.#subnets.rt.map((subnet) => subnet.id),
          securityGroupIds: [rtSecGroup.id],
        },
      },
      {
        parent: this,
        // this is so that the lambda is recreated when the db provisioner zip
        // changes (as its versionid goes in the description)
        // replaceOnChanges: ['description'],
      },
    );
  }
}
