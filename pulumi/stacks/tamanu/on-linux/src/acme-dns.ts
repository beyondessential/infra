import * as awsNative from '@pulumi/aws-native';
import { jsonStringify } from '@pulumi/pulumi';
import { instances, zoneId } from './config.ts';

const tags = [
  {
    key: 'Purpose',
    value: 'tamanu-acme-dns',
  },
  {
    key: 'ManagedBy',
    value: 'pulumi',
  },
];

const acmeDnsPolicy = new awsNative.iam.ManagedPolicy('acme-dns-route53-policy', {
  policyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['route53:ListHostedZones', 'route53:GetChange'],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: ['route53:ChangeResourceRecordSets'],
        Resource: zoneId.apply((id) => `arn:aws:route53:::hostedzone/${id}`),
        Condition: {
          'ForAllValues:StringLike': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['_acme-challenge.*'],
            'route53:ChangeResourceRecordSetsRecordTypes': ['TXT'],
          },
        },
      },
    ],
  }),
});

export const acmeDnsUsers = instances
  .filter((inst) => inst.external && inst.externalIps && inst.externalIps.length > 0)
  .map(
    (inst) =>
      new awsNative.iam.User(
        `tamanu-acme-dns-${inst.id}`,
        {
          tags,
          managedPolicyArns: [acmeDnsPolicy.policyArn],
        },
        { parent: acmeDnsPolicy },
      ).userName,
  );
