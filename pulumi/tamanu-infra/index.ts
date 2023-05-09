import {
  Repository,
  RepositoryImageTagMutability,
} from "@pulumi/aws-native/ecr";
import { Cluster } from "@pulumi/aws-native/ecs";
import { PrivateDnsNamespace } from "@pulumi/aws/servicediscovery";
import { VPC, EgressOnlyInternetGateway, Subnet } from "@pulumi/aws-native/ec2";

// Container repos for tamanu server images
const ecrRepositories = Object.fromEntries([
  "central",
  "facility",
  "meta",
].map((image) =>
  [image, new Repository(`tamanu-${image}`, {
    repositoryName: `tamanu/${image}`,
    imageTagMutability: RepositoryImageTagMutability.Immutable,
  })]
));

// Common infra for internal tamanu services
const { vpcId } = new VPC("tamanu-internal-vpc", {
  enableDnsSupport: true,
  cidrBlock: "10.32.0.0/14",
});
new EgressOnlyInternetGateway("tamanu-internal-egw", {
  vpcId,
});
const subnet = new Subnet("tamanu-internal-subnet", {
  vpcId,
  cidrBlock: "10.32.0.0/16",
  availabilityZone: "ap-southeast-2a",
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
  ecsCluster: cluster.arn,
  cloudmapNamespace: namespace.arn,
};
