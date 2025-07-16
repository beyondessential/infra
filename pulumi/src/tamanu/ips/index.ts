import { getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { BUCKET_NAME } from '../ips-infra/constants.ts';
import { AWS_EC2, AWS_S3_WRITE_ACTIONS } from '../../constants/external.ts';
import { AWS_TAMANU_INTERNAL_CERTBOT_POLICY } from '../../constants/internal.ts';

new awsClassic.iam.InstanceProfile('ec2-ips-s3', {
  name: `EC2InstanceProfileForIPSDataPush-${getStack()}`,
  role: new awsClassic.iam.Role('ec2-ips-s3', {
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
    managedPolicyArns: [AWS_TAMANU_INTERNAL_CERTBOT_POLICY],
    inlinePolicies: [
      {
        name: 'IPSDataPush',
        policy: jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: AWS_S3_WRITE_ACTIONS,
              Resource: [BUCKET_NAME].flatMap((bucket) => [
                `arn:aws:s3:::${bucket}`,
                `arn:aws:s3:::${bucket}/${getStack()}/*`,
              ]),
            },
          ],
        }),
      },
    ],
  }),
});
