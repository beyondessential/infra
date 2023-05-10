import { Netmask } from 'netmask';
import { ComponentResource, ComponentResourceOptions, Output, getStack } from '@pulumi/pulumi';
import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr';
import { Cluster } from '@pulumi/aws-native/ecs';
import { PrivateDnsNamespace } from '@pulumi/aws/servicediscovery';
import { Vpc, EgressOnlyInternetGateway, Subnet, SecurityGroup } from '@pulumi/aws/ec2';
import { SubnetGroup } from '@pulumi/aws/rds';

// Container repos for tamanu server images
const ecrRepositories = Object.fromEntries(
  ['central', 'facility', 'meta'].map((image) => [
    image,
    new Repository(`tamanu-${image}`, {
      repositoryName: `tamanu/${image}`,
      imageTagMutability: RepositoryImageTagMutability.Immutable,
    }),
  ]),
);

export const repoCentral = ecrRepositories.central.repositoryUri;
export const repoFacility = ecrRepositories.facility.repositoryUri;
export const repoMeta = ecrRepositories.meta.repositoryUri;

interface ClusterInfraArgs {
  ipv4Cidr: string;
  ipv4SubnetBlock?: number;
  ipv6SubnetBlock?: number;
  azCoverage: string[];
}

interface ClusterInfraOutputs {
  vpc: Output<string>;
  eigw: Output<string>;
  subnets: Output<string>[];
  dbSecGroup: Output<string>;
  dbSubnetGroup: Output<string>;
  ecsCluster: Output<string>;
  cloudmapNamespace: Output<string>;
}

class ClusterInfra extends ComponentResource {
  #name: string;
  #args: ClusterInfraArgs;

  #vpc: Vpc;
  #subnets: Subnet[] = [];

  outputs: ClusterInfraOutputs;

  constructor(name: string, args: ClusterInfraArgs, opts: ComponentResourceOptions = {}) {
    super('pkg:index:ClusterInfra', name, {}, opts);
    this.#name = name;
    this.#args = args;

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

    for (const az of args.azCoverage) {
      this.addSubnet(az);
    }

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
        subnetIds: this.#subnets.map((subnet) => subnet.id),
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
        subnets: this.#subnets.map((subnet) => subnet.id),
        dbSecGroup: dbSecGroup.id,
        dbSubnetGroup: dbSubnetGroup.name,
        ecsCluster: ecsCluster.arn,
        cloudmapNamespace: namespace.arn,
      }),
    );
  }

  addSubnet(az: string) {
    const subnetIndex = this.#subnets.length;
    let ipv4BlockCalc = new Netmask(
      new Netmask(this.#args.ipv4Cidr).base,
      this.#args.ipv4SubnetBlock?.toString(),
    );
    for (let i = 0; i < subnetIndex; i += 1) {
      ipv4BlockCalc = ipv4BlockCalc.next();
    }
    const ipv4Block = ipv4BlockCalc.toString();

    const ipv6Block = this.#vpc.ipv6CidrBlock.apply((cidr) =>
      cidr.replace('00::/56', `${subnetIndex.toString(16).padStart(2, '0')}::/64`),
    );

    this.#subnets.push(
      new Subnet(
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
      ),
    );
  }
}

const { outputs: internal } = new ClusterInfra('tamanu-internal', {
  ipv4Cidr: '10.32.0.0/16',
  ipv4SubnetBlock: 20,
  ipv6SubnetBlock: 64,
  azCoverage: ['a', 'b'],
});

export const internalVpc = internal.vpc;
export const internalEigw = internal.eigw;
export const internalSubnets = internal.subnets;
export const internalDbSecGroup = internal.dbSecGroup;
export const internalDbSubnetGroup = internal.dbSubnetGroup;
export const internalEcsCluster = internal.ecsCluster;
export const internalCloudmapNamespace = internal.cloudmapNamespace;
