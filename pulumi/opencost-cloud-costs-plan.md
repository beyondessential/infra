# OpenCost Cloud Costs Integration (Athena/CUR) - Multi-Account Setup

## Overview

This integration pulls actual AWS billing data from Cost and Usage Reports (CUR)
via Athena, giving visibility into all AWS costs (not just K8s). This includes
RDS, S3, Lambda, and other services.

For a multi-account AWS Organization setup:
- CUR is configured in the management account (`_BES_Primary`)
- CUR automatically includes all member account costs
- OpenCost in each EKS cluster (in member accounts) uses cross-account role assumption to query Athena

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
- Glue crawler configured to catalog CUR data

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Management Account (_BES_Primary - 295280690919)                       │
│  ┌────────────────┐  ┌─────────────────┐  ┌────────────────────────────┐│
│  │ CUR S3 Bucket  │  │ Athena/Glue     │  │ OpenCostCURAccessRole      ││
│  │ (billing data) │  │ (query engine)  │  │ (trusts org principals)    ││
│  └────────────────┘  └─────────────────┘  └────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ sts:AssumeRole
                                   │
┌──────────────────────────────────┼──────────────────────────────────────┐
│  Member Account (e.g. _Internal_Tamanu)                                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ EKS Cluster                                                      │  │
│  │  ┌─────────────┐    ┌────────────────────────┐                   │  │
│  │  │ OpenCost    │───▶│ IRSA Role              │                   │  │
│  │  │ Pod         │    │ (can assume mgmt role) │                   │  │
│  │  └─────────────┘    └────────────────────────┘                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Management Account Resources (new `org` stack)

Create a new Pulumi stack `org` for organization-wide resources in `_BES_Primary`.

#### 1.1 CUR S3 Bucket and Report

```typescript
// pulumi/stacks/org/src/cur.ts
import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { nativeTags } from '../../common/tags.ts';

const tags = { Purpose: 'cost-reporting' };

const curBucket = new awsNative.s3.Bucket('cur-bucket', {
  bucketName: 'bes-cost-usage-reports',
  tags: nativeTags(tags),
  ownershipControls: {
    rules: [{ objectOwnership: 'BucketOwnerEnforced' }],
  },
  publicAccessBlockConfiguration: {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  },
});

new aws.s3.BucketPolicy('cur-bucket-policy', {
  bucket: curBucket.bucketName.apply((n) => n!),
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowCURService',
        Effect: 'Allow',
        Principal: {
          Service: 'billingreports.amazonaws.com',
        },
        Action: ['s3:GetBucketAcl', 's3:GetBucketPolicy', 's3:PutObject'],
        Resource: [curBucket.arn, interpolate`${curBucket.arn}/*`],
        Condition: {
          StringEquals: {
            'aws:SourceAccount': '295280690919',
          },
        },
      },
    ],
  }),
});

// CUR Report - MUST be created in us-east-1 (AWS requirement)
// Using aws-classic as it has full CUR support
const usEast1 = new aws.Provider('us-east-1', {
  region: 'us-east-1',
});

const curReport = new aws.cur.ReportDefinition(
  'cur-report',
  {
    reportName: 'bes-cur-athena',
    timeUnit: 'HOURLY',
    format: 'Parquet',
    compression: 'Parquet',
    additionalSchemaElements: ['RESOURCES'],
    additionalArtifacts: ['ATHENA'],
    reportVersioning: 'OVERWRITE_REPORT',
    refreshClosedReports: true,
    s3Bucket: curBucket.bucketName.apply((n) => n!),
    s3Prefix: 'cur',
    s3Region: 'ap-southeast-2',
    tags,
  },
  { provider: usEast1 },
);

export const curBucketName = curBucket.bucketName.apply((n) => n!);
export const curBucketArn = curBucket.arn;
export const curReportName = curReport.reportName;
```

#### 1.2 Athena Results Bucket

```typescript
// pulumi/stacks/org/src/athena.ts
import * as awsNative from '@pulumi/aws-native';
import { nativeTags } from '../../common/tags.ts';

const tags = { Purpose: 'athena-query-results' };

const athenaResultsBucket = new awsNative.s3.Bucket('athena-results', {
  bucketName: 'bes-athena-query-results',
  tags: nativeTags(tags),
  ownershipControls: {
    rules: [{ objectOwnership: 'BucketOwnerEnforced' }],
  },
  publicAccessBlockConfiguration: {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  },
  lifecycleConfiguration: {
    rules: [
      {
        id: 'expire-old-results',
        status: 'Enabled',
        expirationInDays: 7,
      },
    ],
  },
});

export const athenaResultsBucketName = athenaResultsBucket.bucketName.apply((n) => n!);
export const athenaResultsBucketArn = athenaResultsBucket.arn;
```

#### 1.3 Cross-Account Access Role in Management Account

```typescript
// pulumi/stacks/org/src/opencost-cur-role.ts
import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';
import { nativeTags } from '../../common/tags.ts';
import { AWS_ORG_ID } from '../../constants/internal.ts';
import { curBucketArn } from './cur.ts';
import { athenaResultsBucketArn } from './athena.ts';

const tags = { Purpose: 'opencost-cur-access' };

// This role is in the management account and can be assumed by
// OpenCost IRSA roles in member accounts
export const opencostCurAccessRole = new awsNative.iam.Role('opencost-cur-access', {
  roleName: 'OpenCostCURAccess',
  description: 'Cross-account role for OpenCost to access CUR data via Athena',
  tags: nativeTags(tags),
  assumeRolePolicyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          AWS: '*',
        },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: {
            'aws:PrincipalOrgID': AWS_ORG_ID,
          },
          ArnLike: {
            // Only allow roles named EKSOpenCostCloudCosts-* to assume
            'aws:PrincipalArn': 'arn:aws:iam::*:role/EKSOpenCostCloudCosts-*',
          },
        },
      },
    ],
  }),
  policies: [
    {
      policyName: 'AthenaAccess',
      policyDocument: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AthenaQueryAccess',
            Effect: 'Allow',
            Action: [
              'athena:GetQueryExecution',
              'athena:GetQueryResults',
              'athena:GetWorkGroup',
              'athena:StartQueryExecution',
              'athena:StopQueryExecution',
            ],
            Resource: [
              'arn:aws:athena:ap-southeast-2:295280690919:workgroup/primary',
            ],
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
            Resource: [
              'arn:aws:glue:ap-southeast-2:295280690919:catalog',
              'arn:aws:glue:ap-southeast-2:295280690919:database/athenacurcfn_bes_cur_athena',
              'arn:aws:glue:ap-southeast-2:295280690919:table/athenacurcfn_bes_cur_athena/*',
            ],
          },
          {
            Sid: 'S3CURAccess',
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:ListBucket'],
            Resource: [curBucketArn, interpolate`${curBucketArn}/*`],
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
            Resource: [athenaResultsBucketArn, interpolate`${athenaResultsBucketArn}/*`],
          },
        ],
      }),
    },
  ],
});

export const opencostCurAccessRoleArn = opencostCurAccessRole.arn;
```

### Phase 2: Member Account IRSA Role (k8s-core stack)

Add to existing `k8s-core` stack, gated by config.

```typescript
// pulumi/stacks/k8s-core/opencostCloudCosts.ts
import { interpolate, jsonStringify, Config } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { clusterName, oidcProvider } from './cluster.ts';

const cfg = new Config();
const enableCloudCosts = cfg.getBoolean('opencostCloudCosts') ?? false;

// ARN of the role in the management account
const MANAGEMENT_ACCOUNT_ID = '295280690919';
const OPENCOST_CUR_ROLE_ARN = `arn:aws:iam::${MANAGEMENT_ACCOUNT_ID}:role/OpenCostCURAccess`;

export const cloudCostsRole = enableCloudCosts
  ? (() => {
      const policy = new awsNative.iam.ManagedPolicy('opencost-cloud-costs-policy', {
        description: interpolate`OpenCost Cloud Costs cross-account access (cluster: ${clusterName})`,
        policyDocument: jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AllowAssumeManagementAccountRole',
              Effect: 'Allow',
              Action: 'sts:AssumeRole',
              Resource: OPENCOST_CUR_ROLE_ARN,
            },
          ],
        }),
      });

      return eksServiceAccount('opencost-cloud-costs-role', {
        roleName: 'EKSOpenCostCloudCosts-',
        roleDescription: interpolate`OpenCost Cloud Costs service account (cluster: ${clusterName})`,
        serviceAccountName: 'opencost',
        oidcProviderArn: oidcProvider.arn,
        namespace: 'metrics-system',
        managedPolicyArns: [policy.policyArn],
      });
    })()
  : undefined;

export const cloudCostsRoleArn = cloudCostsRole?.arn;
```

Update `k8s-core/index.ts` to export the new role ARN:

```typescript
import { cloudCostsRoleArn } from './opencostCloudCosts.ts';
export { cloudCostsRoleArn as opencostCloudCostsRoleArn };
```

Update `common/CrossStack.ts` to include the new output:

```typescript
export interface CrossStackK8sCoreOutput {
  // ... existing fields ...
  opencostCloudCostsRoleArn?: Output<string>;
}

// In k8sCoreOutput():
opencostCloudCostsRoleArn: this.get('opencostCloudCostsRoleArn'),
```

### Phase 3: Kubernetes Resources (k8s-essentials stack)

Update `k8s-essentials/metrics/opencost.ts`:

```typescript
import * as k8s from '@pulumi/kubernetes';
import { jsonStringify } from '@pulumi/pulumi';
import { namespace } from './namespace.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { $core, region } from '../../common/k8s/coreRef.ts';

const opencostRoleArn = $core.opencostRoleArn;
const spotBucket = $core.spotDataFeedBucketName;
const cloudCostsRoleArn = $core.opencostCloudCostsRoleArn;

// Management account constants
const MANAGEMENT_ACCOUNT_ID = '295280690919';
const OPENCOST_CUR_ROLE_ARN = `arn:aws:iam::${MANAGEMENT_ACCOUNT_ID}:role/OpenCostCURAccess`;

// Create cloud integration secret only if cloud costs is enabled
const cloudIntegrationSecret = cloudCostsRoleArn
  ? new k8s.core.v1.Secret('opencost-cloud-integration', {
      metadata: {
        name: 'opencost-cloud-integration',
        namespace,
      },
      stringData: {
        'cloud-integration.json': jsonStringify({
          aws: {
            athena: [
              {
                bucket: 'bes-athena-query-results',
                region: 'ap-southeast-2',
                database: 'athenacurcfn_bes_cur_athena',
                table: 'bes_cur_athena',
                workgroup: 'primary',
                account: MANAGEMENT_ACCOUNT_ID,
                masterPayerArn: OPENCOST_CUR_ROLE_ARN,
              },
            ],
          },
        }),
      },
    })
  : undefined;

new k8s.helm.v3.Release(
  'opencost',
  {
    name: 'opencost',
    chart: 'opencost',
    version: '2.5.3',
    repositoryOpts: {
      repo: 'https://opencost.github.io/opencost-helm-chart',
    },
    namespace,
    values: {
      serviceAccount: {
        create: true,
        annotations: {
          'eks.amazonaws.com/role-arn': cloudCostsRoleArn ?? opencostRoleArn,
        },
      },
      opencost: {
        prometheus: {
          internal: {
            enabled: true,
            serviceName: 'prometheus-server',
            namespaceName: namespace,
            port: 80,
          },
        },
        ui: {
          enabled: true,
        },
        // Cloud costs configuration (only if enabled)
        ...(cloudCostsRoleArn
          ? {
              cloudIntegrationSecret: 'opencost-cloud-integration',
              cloudCost: {
                enabled: true,
                refreshRateHours: 6,
                runWindowDays: 3,
                monthToDateInterval: 6,
                queryWindowDays: 7,
              },
            }
          : {}),
        tolerations: [CAN_RUN_ON_SPOT],
        affinity: {
          nodeAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [
              {
                weight: 1,
                preference: RUN_ON_SPOT,
              },
            ],
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    { key: 'bes.node.purpose', operator: 'In', values: ['workload'] },
                  ],
                },
              ],
            },
          },
        },
        exporter: {
          extraEnv: {
            AWS_SPOT_DATA_BUCKET: spotBucket,
            AWS_SPOT_DATA_REGION: region,
            AWS_SPOT_DATA_PREFIX: 'spot-pricing',
          },
          resources: {
            requests: {
              cpu: '10m',
              memory: '55Mi',
            },
            limits: {
              memory: '256Mi',
            },
          },
        },
      },
    },
  },
  {
    deleteBeforeReplace: true,
  },
);
```

## Deployment Order

1. **Create `org` stack** in management account (`_BES_Primary`)
   - CUR bucket and report
   - Athena results bucket  
   - Cross-account access role

2. **Deploy `org` stack** - CUR report is created automatically via Pulumi
   - Wait 24-48 hours for first report to be generated

3. **Set up Athena integration** (one-time, can use CloudFormation template from AWS)
   - Creates Glue database and crawler

4. **Update k8s-core stacks** in member accounts with EKS clusters
   - Add `opencostCloudCosts: true` to Pulumi config
   - Deploy to create IRSA role

5. **Update k8s-essentials stacks**
   - Deploy to create cloud integration secret and update OpenCost helm release

## Verification

1. Check OpenCost logs for Athena connection:
```bash
kubectl logs -n metrics-system -l app.kubernetes.io/name=opencost | grep -i athena
```

2. Verify role assumption works:
```bash
kubectl exec -n metrics-system -it deploy/opencost -- \
  aws sts assume-role --role-arn arn:aws:iam::295280690919:role/OpenCostCURAccess \
  --role-session-name test
```

3. In the OpenCost UI, check for "Cloud Costs" section

4. Test Athena connectivity:
```bash
kubectl exec -n metrics-system -it deploy/opencost -- \
  wget -qO- http://localhost:9003/cloudCost
```

## Notes

- CUR data has a 24-48 hour delay from AWS
- First report generation can take up to 24 hours after enabling
- Athena queries are charged per TB scanned; OpenCost uses partitions to minimize scans
- The `masterPayerArn` field in cloud integration tells OpenCost to assume this role for Athena queries
- If adding more EKS clusters in future, just enable the config flag - no changes needed in management account