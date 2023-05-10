import { getStack } from "@pulumi/pulumi";
import {
  Repository,
  RepositoryImageTagMutability,
} from "@pulumi/aws-native/ecr";
import { Cluster } from "@pulumi/aws-native/ecs";
import { PrivateDnsNamespace } from "@pulumi/aws/servicediscovery";
import { Vpc, EgressOnlyInternetGateway, Subnet } from "@pulumi/aws/ec2";

// Container repos for tamanu server images
const ecrRepositories = Object.fromEntries(
  ["central", "facility", "meta"].map((image) => [
    image,
    new Repository(`tamanu-${image}`, {
      repositoryName: `tamanu/${image}`,
      imageTagMutability: RepositoryImageTagMutability.Immutable,
    }),
  ])
);

// Common infra for internal tamanu services
const { id: vpcId, ipv6CidrBlock } = new Vpc("tamanu-internal-vpc", {
  enableDnsSupport: true,
  cidrBlock: "10.32.0.0/16",
  assignGeneratedIpv6CidrBlock: true,
  tags: {
    Name: `tamanu-internal-vpc-${getStack()}`,
  },
});
new EgressOnlyInternetGateway("tamanu-internal-egw", {
  vpcId,
});

const subnetIpv4 = "10.32.0.0/20";
const subnetIpv6 = ipv6CidrBlock.apply((cidr) => cidr.replace("::/56", "::/64"));
const subnet = new Subnet("tamanu-internal-subnet", {
  vpcId,
  cidrBlock: subnetIpv4,
  availabilityZone: "ap-southeast-2a",

  // get the first /64 from the /56 allocated to the VPC
  ipv6CidrBlock: subnetIpv6,
});

const cluster = new Cluster("tamanu-internal-cluster");
const namespace = new PrivateDnsNamespace("tamanu-internal-cloudmap", {
  vpc: vpcId,
});

// Outputs
export const repoCentral = ecrRepositories.central.repositoryUri;
export const repoFacility = ecrRepositories.facility.repositoryUri;
export const repoMeta = ecrRepositories.meta.repositoryUri;
export const internalVpc = vpcId;
export const internalSubnet = subnet.id;
export const internalSubnetIpv4 = subnetIpv4;
export const internalSubnetIpv6 = subnetIpv6;
export const internalEcsCluster = cluster.arn;
export const internalCloudmapNamespace = namespace.arn;
