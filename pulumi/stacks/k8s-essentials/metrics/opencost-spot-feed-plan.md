# OpenCost Spot Instance Data Feed Integration

## Overview

This integration provides accurate spot instance pricing to OpenCost by reading
from AWS's Spot Instance Data Feed, which publishes hourly pricing data to an
S3 bucket.

## Cost

- S3 storage: ~$0.01-0.10/month (spot feed files are small)
- S3 requests: negligible

## Implementation Steps

### 1. Create S3 Bucket for Spot Data Feed

Add to `core` stack:

```typescript
const spotDataFeedBucket = new aws.s3.BucketV2('spot-data-feed', {
  bucket: `bes-spot-data-feed-${accountId}`,
  tags: {
    Purpose: 'spot-pricing-data',
  },
});

new aws.s3.BucketLifecycleConfigurationV2('spot-data-feed-lifecycle', {
  bucket: spotDataFeedBucket.id,
  rules: [
    {
      id: 'expire-old-data',
      status: 'Enabled',
      expiration: {
        days: 30, // Keep 30 days of pricing history
      },
    },
  ],
});
```

and export the bucket name/arn in such a way that they can be used in the crossstack abstraction.

### 2. Enable Spot Instance Data Feed

In the `core` stack:

```typescript
new aws.ec2.SpotDatafeedSubscription('spot-data-feed', {
  bucket: spotDataFeedBucket.bucket,
  prefix: 'spot-pricing',
});
```

### 3. Create IAM Role for OpenCost

Add to `k8s-core` alongside other EKS service accounts:

```typescript
const spotDataFeedBucket = /* obtained from crossstack abstraction */;

const opencostSpotPolicy = new aws.iam.Policy('opencost-spot-policy', {
  namePrefix: 'EKSOpenCostSpotAccess-',
  description: `OpenCost Spot Data Feed access (cluster: ${clusterName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'SpotDataAccess',
        Effect: 'Allow',
        Action: [
          's3:ListAllMyBuckets',
          's3:ListBucket',
          's3:HeadBucket',
          's3:HeadObject',
          's3:List*',
          's3:Get*',
        ],
        Resource: [
          spotDataFeedBucket.arn,
          interpolate`${spotDataFeedBucket.arn}/*`,
        ],
      },
    ],
  },
});

const opencostRole = eksServiceAccount('opencost-sa-role', {
  roleName: 'EKSOpenCost-',
  roleDescription: interpolate`OpenCost service account (cluster: ${clusterName})`,
  serviceAccountName: 'opencost',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'metrics-system',
  managedPolicyArns: [opencostSpotPolicy.arn],
});

// Export for use in k8s-essentials
export const opencostRoleArn = opencostRole.arn;
export const spotDataFeedBucketName = spotDataFeedBucket.name;
export const spotDataFeedRegion = region;
```

### 4. Update OpenCost Helm Values

In `k8s-essentials/metrics/opencost.ts`:

```typescript
import { $core } from '../../common/k8s/coreRef.ts';

const opencostRoleArn = $core.get('opencostRoleArn');
const spotBucket = $core.get('spotDataFeedBucketName');
const spotRegion = $core.get('spotDataFeedRegion');

new k8s.helm.v3.Release('opencost', {
  // ... existing config ...
  values: {
    serviceAccount: {
      create: true,
      annotations: {
        'eks.amazonaws.com/role-arn': opencostRoleArn,
      },
    },
    opencost: {
      // ... existing config ...
      exporter: {
        extraEnv: {
          AWS_SPOT_DATA_BUCKET: spotBucket,
          AWS_SPOT_DATA_REGION: spotRegion,
          AWS_SPOT_DATA_PREFIX: 'spot-pricing',
        },
      },
    },
  },
});
```

## Verification

After deployment, check OpenCost logs:
```bash
kubectl logs -n metrics-system -l app.kubernetes.io/name=opencost
```

Look for:
- "Spot data feed configured" or similar
- No S3 access errors

In the OpenCost UI, spot instances should show actual spot prices instead of estimates.

## Notes

- Spot Data Feed updates hourly, so there's a delay in pricing accuracy
- The feed is account-wide, so all clusters in the account benefit
- Feed files are small (~KB per hour), storage costs are negligible
