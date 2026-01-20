# OpenCost Cloud Costs Integration (Athena/CUR)

## Overview

This integration pulls actual AWS billing data from Cost and Usage Reports (CUR)
via Athena, giving visibility into all AWS costs (not just K8s). This includes
RDS, S3, Lambda, and other services.

## Cost

- Athena queries: ~$5-20/month depending on query frequency and data size
  - OpenCost queries every 6 hours by default
  - Athena charges $5 per TB scanned
- S3 storage for CUR data: ~$1-5/month depending on account complexity
- S3 storage for Athena results: negligible
- Glue Data Catalog: free (first million objects)

**Estimated total: $5-25/month**

## Prerequisites

- AWS Cost and Usage Reports must be enabled (can take 24h for first report)
- Athena must be set up with the CUR database
- This is typically done at the organization/payer account level

## Implementation Steps

### 1. Set Up Cost and Usage Reports

Make a new pulumi stack called `org`, for org-wide stuff like this, then:

```typescript
const curBucket = new aws.s3.BucketV2('cur-bucket', {
  bucket: `bes-cost-usage-reports`,
});

new aws.s3.BucketPolicy('cur-bucket-policy', {
  bucket: curBucket.id,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowCUR',
        Effect: 'Allow',
        Principal: {
          Service: 'billingreports.amazonaws.com',
        },
        Action: ['s3:GetBucketAcl', 's3:GetBucketPolicy'],
        Resource: curBucket.arn,
      },
      {
        Sid: 'AllowCURWrite',
        Effect: 'Allow',
        Principal: {
          Service: 'billingreports.amazonaws.com',
        },
        Action: 's3:PutObject',
        Resource: interpolate`${curBucket.arn}/*`,
      },
    ],
  },
});

// Note: aws.cur.ReportDefinition requires the aws-native provider
// and must be created in us-east-1
```

### 2. Create Athena Results Bucket

```typescript
const athenaResultsBucket = new aws.s3.BucketV2('athena-results', {
  bucket: `bes-athena-query-results`,
  tags: {
    Purpose: 'athena-query-results',
  },
});

new aws.s3.BucketLifecycleConfigurationV2('athena-results-lifecycle', {
  bucket: athenaResultsBucket.id,
  rules: [
    {
      id: 'expire-old-results',
      status: 'Enabled',
      expiration: {
        days: 7, // Query results don't need long retention
      },
    },
  ],
});
```

### 3. Create IAM Role for OpenCost

In the `k8s-core` stack. This should be gated behind a configuration item, off by default.

This needs to be adapted to be a cross-account connection as the `org` stack will be deployed in the org root only, not in the workload account.

```typescript
const opencostCloudCostsPolicy = new aws.iam.Policy('opencost-cloud-costs-policy', {
  namePrefix: 'EKSOpenCostCloudCosts-',
  description: `OpenCost Cloud Costs access (cluster: ${clusterName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AthenaAccess',
        Effect: 'Allow',
        Action: [
          'athena:GetQueryExecution',
          'athena:GetQueryResults',
          'athena:GetWorkGroup',
          'athena:StartQueryExecution',
          'athena:StopQueryExecution',
        ],
        Resource: '*',
      },
      {
        Sid: 'GlueAccess',
        Effect: 'Allow',
        Action: [
          'glue:GetDatabase',
          'glue:GetDatabases',
          'glue:GetTable',
          'glue:GetTables',
          'glue:GetPartition',
          'glue:GetPartitions',
        ],
        Resource: '*',
      },
      {
        Sid: 'S3CURAccess',
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:ListBucket',
        ],
        Resource: [
          curBucket.arn,
          interpolate`${curBucket.arn}/*`,
        ],
      },
      {
        Sid: 'S3AthenaResultsAccess',
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
          's3:GetBucketLocation',
        ],
        Resource: [
          athenaResultsBucket.arn,
          interpolate`${athenaResultsBucket.arn}/*`,
        ],
      },
    ],
  },
});

const opencostRole = eksServiceAccount('opencost-cloud-costs-role', {
  roleName: 'EKSOpenCostCloudCosts-',
  roleDescription: interpolate`OpenCost Cloud Costs service account (cluster: ${clusterName})`,
  serviceAccountName: 'opencost',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'metrics-system',
  managedPolicyArns: [opencostCloudCostsPolicy.arn],
});
```

### 4. Create Cloud Integration Secret

```typescript
const cloudIntegration = new k8s.core.v1.Secret('opencost-cloud-integration', {
  metadata: {
    name: 'opencost-cloud-integration',
    namespace: 'metrics-system',
  },
  stringData: {
    'cloud-integration.json': pulumi.jsonStringify({
      aws: {
        athena: [
          {
            bucket: athenaResultsBucket.bucket,
            region: region,
            database: 'athenacurcfn_cur_athena_opencost', // From CloudFormation
            table: 'cur_athena_opencost',                 // Usually database name without prefix
            workgroup: 'primary',
            account: accountId,
            authorizer: {
              authorizerType: 'AWSServiceRoleForCostExplorer',
              // Or use IRSA - no explicit credentials needed
            },
          },
        ],
      },
    }),
  },
});
```

### 5. Update OpenCost Helm Values

In the `k8s-essentials` stack.

```typescript
new k8s.helm.v3.Release('opencost', {
  // ... existing config ...
  values: {
    serviceAccount: {
      create: true,
      annotations: {
        'eks.amazonaws.com/role-arn': opencostRole.arn,
      },
    },
    opencost: {
      cloudIntegrationSecret: 'opencost-cloud-integration',
      cloudCost: {
        enabled: true,
        refreshRateHours: 6,      // How often to pull new data
        runWindowDays: 3,         // Days of history per run
        monthToDateInterval: 6,   // Full month refresh frequency
        queryWindowDays: 7,       // Max days per Athena query
      },
      // ... rest of existing config ...
    },
  },
});
```

## Verification

1. Check OpenCost logs for Athena connection:
```bash
kubectl logs -n metrics-system -l app.kubernetes.io/name=opencost | grep -i athena
```

2. In the OpenCost UI, you should see a "Cloud Costs" section showing non-K8s AWS costs

3. Test Athena connectivity:
```bash
kubectl exec -n metrics-system -it deploy/opencost -- \
  wget -qO- http://localhost:9003/cloudCost
```

## Notes

- CUR data has a 24-48 hour delay from AWS
- First report generation can take up to 24 hours after enabling
- Athena queries are charged per TB scanned; OpenCost uses partitions to minimize scans
- For multi-account setups, CUR should be in the payer/management account
- Cross-account access requires additional IAM trust policies

## Multi-Account Setup

For AWS Organizations with multiple accounts:

1. Enable CUR in the management/payer account
2. CUR automatically includes all member account costs
3. OpenCost in each cluster needs cross-account access to the management account's:
   - S3 bucket (CUR data)
   - Athena/Glue (query access)

This requires:
- IAM role in management account with trust policy for member accounts
- OpenCost role in member account that can assume the management account role
