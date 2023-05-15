import { Netmask } from 'netmask';
import {
  ComponentResource,
  ComponentResourceOptions,
  getStack,
  Output,
  output,
} from '@pulumi/pulumi';
import { Cluster } from '@pulumi/aws-native/ecs';
import { PrivateDnsNamespace } from '@pulumi/aws/servicediscovery';
import { Vpc, EgressOnlyInternetGateway, Subnet, SecurityGroup } from '@pulumi/aws/ec2';
import { SubnetGroup } from '@pulumi/aws/rds';

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
  dbSubnetGroup: Output<string>;
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

    // Subnet config for databases
    const dbSecGroup = new SecurityGroup(
      `${name}-dbsecgroup`,
      {
        vpcId: this.#vpc.id,
      },
      {
        parent: this,
      },
    );
    const dbSubnetGroup = new SubnetGroup(
      `${name}-dbsubnetgroup`,
      {
        subnetIds: this.#subnets.db.map((subnet) => subnet.id),
      },
      {
        parent: this,
      },
    );

    const ecsCluster = new Cluster(`${name}-cluster`, {}, { parent: this });
    const namespace = new PrivateDnsNamespace(
      `${name}-cloudmap`,
      {
        vpc: this.#vpc.id,
      },
      { parent: this },
    );

    this.registerOutputs(
      (this.outputs = {
        vpc: this.#vpc.id,
        eigw: eigw.id,
        subnets: output({
          db: this.#subnets.db.map((subnet) => subnet.id),
          rt: this.#subnets.rt.map((subnet) => subnet.id),
        }),
        dbSecGroup: dbSecGroup.id,
        dbSubnetGroup: dbSubnetGroup.name,
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
      `${this.#name}-subnet-${az}`,
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
}
