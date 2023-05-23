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
  RouteTable,
  RouteTableAssociation,
  NatGateway,
} from '@pulumi/aws/ec2';
import { SubnetGroup } from '@pulumi/aws/rds';
// this form is required to import lambda as otherwise it creates a circular dependency error
import * as aws from '@pulumi/aws';
import { Role } from '@pulumi/aws-native/iam';
import { FileArchive } from '@pulumi/pulumi/asset';
import { Eip } from '@pulumi/aws/ec2/eip';

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
  #v4gw: InternetGateway;
  #v6gw: EgressOnlyInternetGateway;
  #routeTable: RouteTable;
  #cluster: Cluster;

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
          Application: 'Tamanu',
        },
      },
      { parent: this },
    );

    this.#v4gw = new InternetGateway(
      `${this.#name}-igw`,
      {
        vpcId: this.#vpc.id,
        tags: {
          Application: 'Tamanu',
        },
      },
      { parent: this.#vpc },
    );

    this.#v6gw = new EgressOnlyInternetGateway(
      `${name}-eigw`,
      {
        vpcId: this.#vpc.id,
        tags: {
          Application: 'Tamanu',
        },
      },
      { parent: this.#vpc },
    );

    this.#routeTable = new RouteTable(
      `${this.#name}-rt`,
      {
        vpcId: this.#vpc.id,
        tags: {
          Application: 'Tamanu',
        },
      },
      { parent: this.#vpc },
    );
    new Route(
      `${this.#name}-rt-out6`,
      {
        routeTableId: this.#routeTable.id,
        destinationIpv6CidrBlock: '::/0',
        egressOnlyGatewayId: this.#v6gw.id,
      },
      { parent: this.#routeTable },
    );

    // up to 16 /20 subnets
    this.#subnets = {
      db: [this.addSubnet('a', 0, 'database'), this.addSubnet('b', 1, 'database')],
      rt: [this.addSubnet('b', 2, 'runtime'), this.addSubnet('c', 3, 'runtime')],
    };

    // Security groups
    const { dbSecGroup, rtSecGroup } = this.securityGroups();

    // Subnet config for databases
    const dbSubnetGroup = new SubnetGroup(
      `${name}-dbsubnetgroup`,
      {
        subnetIds: this.#subnets.db.map((subnet) => subnet.id),
        tags: {
          Purpose: 'database',
          Application: 'Tamanu',
        },
      },
      {
        parent: this.#vpc,
      },
    );

    const namespace = new PrivateDnsNamespace(
      `${name}-cloudmap`,
      {
        vpc: this.#vpc.id,
        tags: {
          Application: 'Tamanu',
        },
      },
      { parent: this.#vpc },
    );

    this.#cluster = new Cluster(
      `${name}-cluster`,
      {
        serviceConnectDefaults: {
          namespace: namespace.arn,
        },
        tags: {
          Application: 'Tamanu',
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
        ecsCluster: this.#cluster.arn,
        cloudmapNamespace: namespace.arn,
      }),
    );
  }

  addSubnet(az: string, index: number, purpose: string) {
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

    const subnet = new Subnet(
      `${this.#name}-subnet-${index}`,
      {
        vpcId: this.#vpc.id,
        cidrBlock: ipv4Block,
        availabilityZone: `ap-southeast-2${az}`,
        ipv6CidrBlock: ipv6Block,
        assignIpv6AddressOnCreation: true,
        tags: {
          Name: `${this.#name}-subnet-${index}-${purpose}`,
          Purpose: purpose,
          Application: 'Tamanu',
        },
      },
      {
        parent: this.#vpc,
      },
    );

    if (purpose === 'runtime') {
      // public route table
      const publicIP = new Eip(
        `${this.#name}-pubip-${index}`,
        {
          tags: {
            Purpose: 'runtime',
            Application: 'Tamanu',
          },
        },
        { parent: subnet },
      );
      const natGateway = new NatGateway(
        `${this.#name}-natgw-${index}`,
        {
          subnetId: subnet.id,
          connectivityType: 'public',
          allocationId: publicIP.allocationId,
          tags: {
            Purpose: 'runtime',
            Application: 'Tamanu',
          },
        },
        { parent: subnet, dependsOn: [this.#v4gw] },
      );
      const routeTable = new RouteTable(
        `${this.#name}-subrt-${index}`,
        {
          vpcId: this.#vpc.id,
          tags: {
            Purpose: 'public',
            Application: 'Tamanu',
          },
        },
        { parent: subnet, dependsOn: [this.#v4gw] },
      );
      new Route(
        `${this.#name}-subrt-${index}-out4`,
        {
          routeTableId: this.#routeTable.id,
          destinationCidrBlock: '0.0.0.0/0',
          natGatewayId: natGateway.id,
        },
        { parent: routeTable },
      );
      new Route(
        `${this.#name}-subrt-${index}-out6`,
        {
          routeTableId: this.#routeTable.id,
          destinationIpv6CidrBlock: '::/0',
          natGatewayId: natGateway.id,
        },
        { parent: routeTable },
      );
      new RouteTableAssociation(
        `${this.#name}-subnetrtassoc-${index}`,
        {
          routeTableId: routeTable.id,
          subnetId: subnet.id,
        },
        { parent: subnet },
      );
    } else {
      // default route table
      new RouteTableAssociation(
        `${this.#name}-subnetrtassoc-${index}`,
        {
          routeTableId: this.#routeTable.id,
          subnetId: subnet.id,
        },
        { parent: subnet },
      );
    }

    return subnet;
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
        tags: {
          Name: `${this.#name}-database`,
          Purpose: 'database',
          Application: 'Tamanu',
        },
      },
      {
        parent: this.#vpc,
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
        tags: {
          Name: `${this.#name}-runtime`,
          Purpose: 'runtime',
          Application: 'Tamanu',
        },
      },
      {
        parent: this.#vpc,
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
      { parent: this.#cluster },
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
        tags: {
          Application: 'Tamanu',
        },
      },
      {
        parent: this.#cluster,
      },
    );
  }
}
