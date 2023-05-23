import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr';
import { Bucket } from '@pulumi/aws-native/s3';
import { ClusterInfra } from './ClusterInfra';

// Container repos for tamanu server and glue images
const ecrRepositories = Object.fromEntries(
  ['central', 'configurator', 'facility', 'meta'].map((image) => [
    image,
    new Repository(`tamanu-${image}`, {
      repositoryName: `tamanu/${image}`,
      imageTagMutability: RepositoryImageTagMutability.Mutable,
    }),
  ]),
);

export const repoCentral = ecrRepositories.central.repositoryUri;
export const repoConfigurator = ecrRepositories.configurator.repositoryUri;
export const repoFacility = ecrRepositories.facility.repositoryUri;
export const repoMeta = ecrRepositories.meta.repositoryUri;

// Common runtime infrastructure for tamanu clusters
export const lambdaBucket = 'tamanu-lambdas';
new Bucket(lambdaBucket, {
  bucketName: lambdaBucket,
});
// As the bucket creates here before you'll have a chance to upload the zip file,
// the pulumi up will fail, but the bucket will then be alive, so go and upload
// to it, then run pulumi up again and it will succeed.

const { outputs: internal } = new ClusterInfra('tamanu-internal', {
  ipv4Cidr: '10.32.0.0/16',
  dbProvisionerLambda: {
    s3Bucket: lambdaBucket,
    s3Key: 'db-provisioner.zip',
  },
});

export const internalVpc = internal.vpc;
export const internalEigw = internal.eigw;
export const internalSubnetsDb = internal.subnets.db;
export const internalSubnetsRt = internal.subnets.rt;
export const internalDbSecGroup = internal.dbSecGroup;
export const internalRtSecGroup = internal.rtSecGroup;
export const internalDbSubnetGroup = internal.dbSubnetGroup;
export const internalDbProvisioner = internal.dbProvisioner;
export const internalEcsCluster = internal.ecsCluster;
export const internalCloudmapNamespace = internal.cloudmapNamespace;
