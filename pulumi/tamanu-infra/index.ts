import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr';
import { Bucket } from '@pulumi/aws-native/s3';
import { ClusterInfra } from './ClusterInfra';
import * as aws from '@pulumi/aws';
import { FileAsset } from '@pulumi/pulumi/asset';

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
const bucket = new Bucket(lambdaBucket, {
  bucketName: lambdaBucket,
  versioningConfiguration: {
    status: 'Enabled',
  }
});

const source = new FileAsset('../../glue/provisioner/target/lambda/provisioner.zip');
const dbProvisioner = new aws.s3.BucketObject('db-provisioner', {
  bucket: lambdaBucket,
  key: 'db-provisioner.zip',
  source,
}, { dependsOn: [bucket] });

const { outputs: internal } = new ClusterInfra('tamanu-internal', {
  ipv4Cidr: '10.32.0.0/16',
  dbProvisioner,
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
