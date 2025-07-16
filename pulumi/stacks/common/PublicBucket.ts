import { ComponentResource, ComponentResourceOptions, Output } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface PublicBucketArgs extends aws.s3.BucketV2Args {
  website?: Omit<aws.s3.BucketWebsiteConfigurationV2Args, 'bucket'>;
}

export class PublicBucket extends ComponentResource {
  readonly bucketId: Output<string>;
  readonly bucketDomainName: Output<string>;
  readonly bucketRegionalDomainName: Output<string>;
  readonly region: Output<string>;
  readonly websiteDomain?: Output<string>;
  readonly websiteEndpoint?: Output<string>;

  constructor(
    name: string,
    { website: websiteArgs, ...args }: PublicBucketArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:common:AwsPublicBucket', name, {}, opts);

    const bucket = new aws.s3.BucketV2('bucket', args, { parent: this });

    new aws.s3.BucketPolicy(
      'bucketPolicy',
      {
        bucket: bucket.bucket,
        policy: bucket.bucket.apply(publicReadPolicyForBucket),
      },
      { parent: this },
    );

    const website =
      websiteArgs &&
      new aws.s3.BucketWebsiteConfigurationV2(
        'bucketWebsite',
        {
          bucket: bucket.id,
          ...websiteArgs,
        },
        { parent: this },
      );

    this.bucketId = bucket.id;
    this.bucketDomainName = bucket.bucketDomainName;
    this.bucketRegionalDomainName = bucket.bucketRegionalDomainName;
    this.region = bucket.region;
    this.websiteDomain = website?.websiteDomain;
    this.websiteEndpoint = website?.websiteEndpoint;

    this.registerOutputs({
      bucketId: this.bucketId,
      bucketDomainName: this.bucketDomainName,
      bucketRegionalDomainName: this.bucketRegionalDomainName,
      region: this.region,
      websiteDomain: this.websiteDomain,
      websiteEndpoint: this.websiteEndpoint,
    });
  }
}

export function publicReadPolicyForBucket(bucketName: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucketName}/*`],
      },
    ],
  });
}
