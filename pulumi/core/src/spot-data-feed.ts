import * as awsNative from '@pulumi/aws-native';
import * as aws from '@pulumi/aws';
import { interpolate } from '@pulumi/pulumi';
import { accountId } from '../../common/awsAccount.ts';
import { nativeTags } from '../../common/tags.ts';
import { tags } from './config.ts';

const spotDataFeedBucket = new awsNative.s3.Bucket('spot-data-feed', {
  bucketName: interpolate`bes-spot-data-feed-${accountId}`,
  tags: nativeTags(tags, {
    Purpose: 'spot-pricing-data',
  }),
  ownershipControls: {
    rules: [
      {
        objectOwnership: 'BucketOwnerPreferred',
      },
    ],
  },
  lifecycleConfiguration: {
    rules: [
      {
        id: 'expire-old-data',
        status: 'Enabled',
        expirationInDays: 30,
      },
    ],
  },
});

export const spotDataFeed = {
  bucketName: spotDataFeedBucket.bucketName.apply((name) => name!),
  arn: spotDataFeedBucket.arn,
};

new aws.ec2.SpotDatafeedSubscription(
  'spot-data-feed',
  {
    bucket: spotDataFeedBucket.bucketName.apply((name) => name!),
    prefix: 'spot-pricing',
  },
  { parent: spotDataFeedBucket },
);
