import * as awsNative from '@pulumi/aws-native';
import * as aws from '@pulumi/aws';
import { interpolate } from '@pulumi/pulumi';
import { accountId, region } from '../../common/awsAccount.ts';
import { nativeTags } from '../../common/tags.ts';
import { tags } from './config.ts';

// spec: CORE#spot-data-feed
// EC2 refuses the subscription where it doesn't offer the feed, and a bucket with nothing
// to receive has no use. Regions are added here as the refusal is met.
const regionsWithoutSpotDataFeed = ['eu-central-2'];

function declareSpotDataFeed() {
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

  const spotDataFeed = {
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

  return spotDataFeed;
}

export const spotDataFeed = regionsWithoutSpotDataFeed.includes(region)
  ? undefined
  : declareSpotDataFeed();
