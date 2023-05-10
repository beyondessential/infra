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
export const repos = {
  central: ecrRepositories.central.repositoryUri,
  facility: ecrRepositories.facility.repositoryUri,
  meta: ecrRepositories.meta.repositoryUri,
};
export const internal = {
  vpc: vpcId,
  subnet: subnet.id,
  subnetIpv4,
  subnetIpv6,
  ecsCluster: cluster.arn,
  cloudmapNamespace: namespace.arn,
};
