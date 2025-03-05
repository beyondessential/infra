import { Config, getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { AWS_EC2, AWS_S3_MULTIPART_ACTIONS } from '../../constants/external.js';

export const BUCKET_NAME = `bes-tamanu-${getStack()}-backups`;

const tags = {
  Purpose: 'backups',
};

const bucket = new awsClassic.s3.BucketV2(
  'backups-bucket',
  {
    bucket: BUCKET_NAME,
    tags,
  },
  { protect: true },
);

const fullPolicy = new awsClassic.iam.Policy('backups-policy', {
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: AWS_S3_MULTIPART_ACTIONS,
        Resource: [BUCKET_NAME].flatMap((bucket) => [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/*`,
        ]),
      },
    ],
  }),
}, { dependsOn: [bucket] });

const fullRole = new awsClassic.iam.Role('backups-role', {
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Principal: {
          Service: AWS_EC2,
        },
      },
    ],
  },
  managedPolicyArns: [fullPolicy.arn],
});

const incomingPolicy = new awsClassic.iam.Policy('backups-incoming-policy', {
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: AWS_S3_MULTIPART_ACTIONS,
        Resource: [BUCKET_NAME].flatMap((bucket) => [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/incoming/*`,
        ]),
      },
    ],
  }),
}, { dependsOn: [bucket] });

const incomingRole = new awsClassic.iam.Role('backups-incoming-role', {
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Principal: {
          Service: AWS_EC2,
        },
      },
    ],
  },
  managedPolicyArns: [incomingPolicy.arn],
});

new awsClassic.iam.InstanceProfile('ec2-backups-instance', {
  name: 'EC2InstanceProfileForTamanuBackupsPush',
  role: incomingRole.name,
});

const config = new Config();
if (config.getBoolean('externalAccessUser')) {
  const user = new awsClassic.iam.User('backups-user', {
    name: 'tamanu-backups',
    tags,
  });

  new awsClassic.iam.UserPolicyAttachment('backups-user', {
    user: user.name,
    policyArn: incomingPolicy.arn,
  });
}
